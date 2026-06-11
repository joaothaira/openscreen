#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import wavefile from "wavefile";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FPS = 30;

// Words/patterns that suggest emphasis or impact (for zoom effects)
// Portuguese (Brazilian) impact patterns
const IMPACT_PATTERNS_PT = [
  // Exclamations
  /!+$/,
  /\?!$/,
  // Numbers and statistics
  /\d+%/,
  /R\$\s?\d+/,
  /\d+x/i,
  // Portuguese action/emphasis words
  /\b(incrível|inacreditável|insano|absurdo|bizarro|épico|lendário|surreal)\b/i,
  /\b(urgente|importante|crítico|atenção|perigo|alerta|cuidado)\b/i,
  /\b(segredo|revelado|exposto|verdade|finalmente|agora|hoje)\b/i,
  /\b(melhor|pior|primeiro|último|único|nunca|sempre|jamais)\b/i,
  /\b(ganhar|ganhei|ganhamos|perder|perdi|perdemos|vencer|sucesso|consegui|dominei)\b/i,
  /\b(milhão|milhões|bilhão|bilhões|mil)\b/i,
  /\b(grátis|gratuito|novo|nova|exclusivo|exclusiva|limitado|especial)\b/i,
  /\b(olha|olhem|cara|mano|gente|galera|pessoal)\b/i,
  /\b(demais|muito|super|mega|ultra|hiper)\b/i,
  /\b(quebrou|explodiu|bombou|viralizou|estourou)\b/i,
  // All caps words (emphasis)
  /\b[A-Z]{3,}\b/,
];

// English impact patterns (fallback)
const IMPACT_PATTERNS_EN = [
  /!+$/,
  /\?!$/,
  /\d+%/,
  /\$\d+/,
  /\d+x/i,
  /\b(amazing|incredible|unbelievable|insane|crazy|huge|massive|epic|legendary)\b/i,
  /\b(breaking|urgent|important|critical|warning|danger|alert)\b/i,
  /\b(secret|revealed|exposed|truth|finally|now|today)\b/i,
  /\b(best|worst|top|first|last|only|never|always|ever)\b/i,
  /\b(win|won|lose|lost|fail|success|achieve|dominate)\b/i,
  /\b(million|billion|thousand|hundred)\b/i,
  /\b(free|new|exclusive|limited|special)\b/i,
  /\b[A-Z]{3,}\b/,
];

// Detect if text is impactful and deserves a zoom
function detectImpact(text, language = "pt") {
  const patterns = language === "pt" ? IMPACT_PATTERNS_PT : IMPACT_PATTERNS_EN;

  const impactScore = patterns.reduce((score, pattern) => {
    return score + (pattern.test(text) ? 1 : 0);
  }, 0);

  if (impactScore >= 2) {
    return { type: "zoomCut", intensity: 2 };
  } else if (impactScore === 1) {
    return { type: "zoomHold", intensity: 1 };
  }
  return null;
}

// Convert seconds to frame number
function secondsToFrame(seconds, fps = FPS) {
  return Math.round(seconds * fps);
}

// Extract audio from video using ffmpeg
async function extractAudio(videoPath, outputPath) {
  console.log("Extraindo áudio do vídeo...");

  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`,
      { stdio: "pipe" }
    );
    console.log("Áudio extraído com sucesso.");
    return true;
  } catch (error) {
    console.error("Erro ao extrair áudio:", error.message);
    return false;
  }
}

// Read WAV file and convert to Float32Array for Whisper
function readWavAsFloat32(audioPath) {
  console.log("Lendo arquivo de áudio...");
  const buffer = readFileSync(audioPath);
  const wav = new wavefile.WaveFile(buffer);

  // Ensure 16-bit PCM format
  wav.toBitDepth("16");

  // Get samples and convert to Float32Array normalized to [-1, 1]
  const samples = wav.getSamples(false, Int16Array);
  const float32 = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    float32[i] = samples[i] / 32768.0;
  }

  return float32;
}

// Transcribe audio using Whisper via transformers.js
async function transcribeAudio(audioPath, language = "portuguese", modelSize = "small") {
  console.log("Carregando modelo Whisper (pode demorar na primeira execução)...");

  const { pipeline } = await import("@xenova/transformers");

  const modelName = `Xenova/whisper-${modelSize}`;
  console.log(`Usando modelo: ${modelName}`);

  const transcriber = await pipeline("automatic-speech-recognition", modelName, {
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  // Read audio file as Float32Array (required for Node.js)
  const audioData = readWavAsFloat32(audioPath);

  console.log("Transcrevendo áudio em português...");

  const result = await transcriber(audioData, {
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
    language: language,
    task: "transcribe",
    sampling_rate: 16000,
  });

  return result;
}

// Group words into subtitle chunks (by sentence or time gaps)
function groupIntoSubtitles(chunks, maxWordsPerSubtitle = 8, maxDuration = 3) {
  const subtitles = [];
  let currentSubtitle = {
    words: [],
    startTime: null,
    endTime: null,
  };

  for (const chunk of chunks) {
    if (!chunk.timestamp) continue;

    const [start, end] = chunk.timestamp;
    const word = chunk.text.trim();

    if (!word) continue;

    // Skip bracketed annotations like [Música], [Music], [Applause], etc.
    if (/^\[.*\]$/.test(word)) continue;

    // Start new subtitle if:
    // 1. Current is empty
    // 2. Too many words
    // 3. Gap > 0.5s between words
    // 4. Duration would exceed max
    // 5. Sentence ends (., !, ?)
    const shouldStartNew =
      currentSubtitle.words.length === 0 ||
      currentSubtitle.words.length >= maxWordsPerSubtitle ||
      (currentSubtitle.endTime && start - currentSubtitle.endTime > 0.5) ||
      (currentSubtitle.startTime && end - currentSubtitle.startTime > maxDuration) ||
      (currentSubtitle.words.length > 0 &&
        /[.!?]$/.test(currentSubtitle.words[currentSubtitle.words.length - 1]));

    if (shouldStartNew && currentSubtitle.words.length > 0) {
      subtitles.push({ ...currentSubtitle });
      currentSubtitle = { words: [], startTime: null, endTime: null };
    }

    currentSubtitle.words.push(word);
    if (currentSubtitle.startTime === null) {
      currentSubtitle.startTime = start;
    }
    currentSubtitle.endTime = end;
  }

  // Push the last subtitle
  if (currentSubtitle.words.length > 0) {
    subtitles.push(currentSubtitle);
  }

  return subtitles;
}

// Words that should not end a subtitle (orphan words) - only applies to short words (< 4 letters)
const ORPHAN_WORDS_PT = new Set([
  // Articles
  "o", "a", "os", "as", "um", "uma", "uns",
  // Prepositions
  "de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos",
  "por", "com", "sem", "sob", "ao", "aos", "à", "às",
  // Conjunctions
  "e", "ou", "mas", "que", "se", "nem",
  // Pronouns
  "eu", "tu", "ele", "ela", "nós", "vós",
  "me", "te", "se", "nos", "vos", "lhe",
  "meu", "teu", "seu",
  // Other common short words
  "não", "já", "só",
]);

const ORPHAN_WORDS_EN = new Set([
  // Articles
  "a", "an", "the",
  // Prepositions
  "of", "to", "in", "on", "at", "by", "for",
  // Conjunctions
  "and", "or", "but", "if", "as", "so", "yet", "nor",
  // Pronouns
  "i", "we", "he", "she", "it", "my", "our", "his", "her", "its",
  // Other
  "is", "are", "was", "be", "has",
]);

// Check if text ends with punctuation
function endsWithPunctuation(text) {
  return /[.,!?;:"""'']$/.test(text.trim());
}

// Fix orphan words at the end of subtitles
function fixOrphanWords(subtitles, language = "pt") {
  const orphanWords = language === "pt" ? ORPHAN_WORDS_PT : ORPHAN_WORDS_EN;
  const result = [...subtitles];

  for (let i = 0; i < result.length - 1; i++) {
    const current = result[i];
    const next = result[i + 1];

    if (current.words.length <= 1) continue;

    // Keep moving words while the last word is an orphan
    while (current.words.length > 1) {
      const lastWord = current.words[current.words.length - 1];
      const lastWordClean = lastWord.replace(/[.,!?;:"""'']/g, "");
      const lastWordLower = lastWordClean.toLowerCase();

      // Stop if word ends with punctuation (good break point)
      if (endsWithPunctuation(lastWord)) break;

      // Words with 4+ letters are fine
      if (lastWordClean.length >= 4) break;

      // Check if it's an orphan word
      const isOrphan = orphanWords.has(lastWordLower);

      if (isOrphan) {
        // Move word to next subtitle
        const wordToMove = current.words.pop();
        next.words.unshift(wordToMove);
      } else {
        break;
      }
    }
  }

  return result;
}

// Format subtitles as TypeScript code
function formatAsTypeScript(subtitles, fps = FPS, language = "pt") {
  const items = subtitles.map((sub) => {
    const text = sub.words.join(" ");
    const startFrame = secondsToFrame(sub.startTime, fps);
    const endFrame = secondsToFrame(sub.endTime, fps);
    const zoom = detectImpact(text, language);

    let item = `      { text: "${text}", startFrame: ${startFrame}, endFrame: ${endFrame}`;

    if (zoom) {
      item += `, zoom: { type: "${zoom.type}" as ZoomType, intensity: ${zoom.intensity} }`;
    }

    item += " }";
    return item;
  });

  return `  subtitles: {
    transition: "slideUp" as TransitionType,
    items: [
${items.join(",\n")},
    ],
  },`;
}

// Group subtitles into sentences (for audio splitting)
function groupIntoSentences(subtitles) {
  const sentences = [];
  let currentSentence = [];

  for (let i = 0; i < subtitles.length; i++) {
    currentSentence.push(i);
    const text = subtitles[i].words.join(" ");

    // End sentence if we hit punctuation or it's the last subtitle
    if (text.match(/[.!?]$/) || i === subtitles.length - 1) {
      sentences.push([...currentSentence]);
      currentSentence = [];
    }
  }

  // Push any remaining subtitles as a sentence
  if (currentSentence.length > 0) {
    sentences.push(currentSentence);
  }

  return sentences;
}

// Split audio file into sentence chunks
async function splitAudioIntoSentences(audioPath, subtitles, sentences, sessionDir, fps = FPS) {
  const audioDir = join(sessionDir, 'audio');
  if (!existsSync(audioDir)) {
    mkdirSync(audioDir, { recursive: true });
  }

  console.log(`\nDividindo áudio em ${sentences.length} sentenças...`);

  const sentenceAudioFiles = [];

  for (let sentenceIdx = 0; sentenceIdx < sentences.length; sentenceIdx++) {
    const subtitleIndices = sentences[sentenceIdx];
    const firstSubIndex = subtitleIndices[0];
    const lastSubIndex = subtitleIndices[subtitleIndices.length - 1];

    const startTime = subtitles[firstSubIndex].startTime;
    const endTime = subtitles[lastSubIndex].endTime;
    const duration = endTime - startTime;

    const outputPath = join(audioDir, `sentence_${sentenceIdx}.wav`);

    try {
      // Extract audio chunk using ffmpeg
      execSync(
        `ffmpeg -y -i "${audioPath}" -ss ${startTime} -t ${duration} -acodec pcm_s16le -ar 44100 -ac 1 "${outputPath}"`,
        { stdio: 'pipe' }
      );

      const durationInFrames = Math.round(duration * fps);
      sentenceAudioFiles.push({
        sentenceId: sentenceIdx,
        path: `/sessions/${basename(sessionDir)}/audio/sentence_${sentenceIdx}.wav`,
        durationInFrames
      });
    } catch (error) {
      console.error(`Erro ao extrair áudio da sentença ${sentenceIdx}:`, error.message);
      sentenceAudioFiles.push(null);
    }
  }

  return sentenceAudioFiles;
}

// Format subtitles as JSON for video-subtitles.json with voice chunks
function formatAsJSON(subtitles, fps = FPS, language = "pt", backgroundVideo = null, titleText = null, template = "bold", sentenceAudioFiles = null) {
  // Group subtitles into sentences
  const sentences = groupIntoSentences(subtitles);

  const items = subtitles.map((sub, index) => {
    const text = sub.words.join(" ");
    const startFrame = secondsToFrame(sub.startTime, fps);
    const endFrame = secondsToFrame(sub.endTime, fps);
    const zoom = detectImpact(text, language);

    const item = { text, startFrame, endFrame };
    if (index === 0) {
      item.zoom = { type: "zoomHold", intensity: 2 };
    } else if (zoom) {
      item.zoom = zoom;
    }

    // Find which sentence this subtitle belongs to
    if (sentenceAudioFiles) {
      for (let sentenceIdx = 0; sentenceIdx < sentences.length; sentenceIdx++) {
        if (sentences[sentenceIdx].includes(index)) {
          item.sentenceId = sentenceIdx;

          // Add voice reference to first chunk of sentence
          const isFirstChunk = sentences[sentenceIdx][0] === index;
          if (isFirstChunk && sentenceAudioFiles[sentenceIdx]) {
            item.voice = {
              src: sentenceAudioFiles[sentenceIdx].path,
              volume: 1.0,
              durationInFrames: sentenceAudioFiles[sentenceIdx].durationInFrames
            };
          }
          break;
        }
      }
    }

    return item;
  });

  // Calculate last frame for title end
  const lastFrame = items.length > 0 ? items[items.length - 1].endFrame : 90;

  const config = {
    background: backgroundVideo
      ? { type: "video", src: `/${backgroundVideo}` }
      : { type: "color", color: "#1a1815" },
    colors: { text: "#ffffff" },
    title: {
      show: !!titleText,
      text: titleText || "",
      startFrame: 0,
      endFrame: 90,
      transition: "slideDown",
      template
    },
    subtitles: {
      transition: "slideUp",
      template,
      items
    },
    style: {
      position: "bottom",
      bottomOffset: 80
    }
  };

  return config;
}

// Main function
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Uso: node scripts/extract-subtitles.mjs <arquivo-video> [opções]

Opções:
  --output, -o    Caminho do arquivo de saída (padrão: exibe no console)
  --json          Saída em formato JSON (para video-subtitles.json)
  --background    Caminho do vídeo de fundo (relativo a public/)
  --title, -t     Título do vídeo (exibido no topo)
  --template      Template: bold, classic, minimal, stacked, fullWidthStacked, etc (padrão: bold)
  --model, -m     Tamanho do modelo Whisper: tiny, base, small, medium (padrão: small)
  --max-words     Máximo de palavras por legenda (padrão: 8)
  --fps           FPS do vídeo para cálculo de frames (padrão: 30)
  --lang, -l      Idioma: pt, en (padrão: pt para português brasileiro)
  --split-audio   Dividir áudio em sentenças e gerar arquivos separados (padrão: false)
  --session-dir   Diretório da sessão (necessário se --split-audio for usado)

Exemplos:
  node scripts/extract-subtitles.mjs public/video.mp4
  node scripts/extract-subtitles.mjs public/video.mp4 -o subtitles.ts
  node scripts/extract-subtitles.mjs public/video.mp4 --json -o video-subtitles.json
  node scripts/extract-subtitles.mjs public/video.mp4 --json --background uploads/bg.mp4
  node scripts/extract-subtitles.mjs public/video.mp4 --model tiny --fps 60
`);
    process.exit(1);
  }

  const videoPath = args[0];

  // Parse options
  let outputPath = null;
  let modelSize = "small";
  let maxWords = 8;
  let fps = FPS;
  let language = "pt";
  let jsonFormat = false;
  let backgroundVideo = null;
  let titleText = null;
  let template = "bold";
  let splitAudio = false;
  let sessionDir = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--output" || args[i] === "-o") {
      outputPath = args[++i];
    } else if (args[i] === "--model" || args[i] === "-m") {
      modelSize = args[++i];
    } else if (args[i] === "--max-words") {
      maxWords = parseInt(args[++i]);
    } else if (args[i] === "--fps") {
      fps = parseInt(args[++i]);
    } else if (args[i] === "--lang" || args[i] === "-l") {
      language = args[++i];
    } else if (args[i] === "--json") {
      jsonFormat = true;
    } else if (args[i] === "--background") {
      backgroundVideo = args[++i];
    } else if (args[i] === "--title" || args[i] === "-t") {
      titleText = args[++i];
    } else if (args[i] === "--template") {
      template = args[++i];
    } else if (args[i] === "--split-audio") {
      splitAudio = true;
    } else if (args[i] === "--session-dir") {
      sessionDir = args[++i];
    }
  }

  // Auto-detect session dir from output path if not provided
  if (splitAudio && !sessionDir && outputPath) {
    // Try to extract from path like /path/to/datalake/session-xxx/video-subtitles.json
    const match = outputPath.match(/(.*\/session-[^/]+)/);
    if (match) {
      sessionDir = match[1];
    }
  }

  const whisperLang = language === "pt" ? "portuguese" : "english";

  if (!existsSync(videoPath)) {
    console.error(`Erro: Arquivo de vídeo não encontrado: ${videoPath}`);
    process.exit(1);
  }

  // Create temp directory for audio
  const tempDir = join(__dirname, "..", ".temp");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const videoBasename = basename(videoPath).replace(/\.[^.]+$/, "");
  const audioPath = join(tempDir, `${videoBasename}.wav`);

  try {
    // Step 1: Extract audio
    const audioExtracted = await extractAudio(videoPath, audioPath);
    if (!audioExtracted) {
      process.exit(1);
    }

    // Step 2: Transcribe
    const transcription = await transcribeAudio(audioPath, whisperLang, modelSize);

    console.log("\nTranscrição:", transcription.text);
    console.log(`\nEncontrados ${transcription.chunks?.length || 0} timestamps de palavras`);

    // Step 3: Group into subtitles
    const rawSubtitles = groupIntoSubtitles(transcription.chunks || [], maxWords);

    // Step 3.5: Fix orphan words at the end of subtitles
    const subtitles = fixOrphanWords(rawSubtitles, language);

    console.log(`\nAgrupados em ${subtitles.length} legendas`);

    // Step 4: Split audio into sentences if requested
    let sentenceAudioFiles = null;
    if (splitAudio && jsonFormat) {
      if (!sessionDir) {
        console.error('\nErro: --session-dir é necessário quando --split-audio é usado');
        process.exit(1);
      }

      const sentences = groupIntoSentences(subtitles);
      sentenceAudioFiles = await splitAudioIntoSentences(audioPath, subtitles, sentences, sessionDir, fps);
      console.log(`\nCriados ${sentenceAudioFiles.filter(f => f).length} arquivos de áudio`);
    }

    // Step 5: Format output
    let output;
    if (jsonFormat) {
      const jsonConfig = formatAsJSON(subtitles, fps, language, backgroundVideo, titleText, template, sentenceAudioFiles);
      output = JSON.stringify(jsonConfig, null, 2);
    } else {
      output = formatAsTypeScript(subtitles, fps, language);
    }

    // Step 6: Output
    if (outputPath) {
      writeFileSync(outputPath, output);
      console.log(`\nLegendas escritas em: ${outputPath}`);
    } else {
      if (jsonFormat) {
        console.log("\n--- JSON Config ---\n");
        console.log(output);
        console.log("\n--- Copie para video-subtitles.json ---\n");
      } else {
        console.log("\n--- TypeScript Gerado ---\n");
        console.log(output);
        console.log("\n--- Copie o código acima para seu constants.ts ---\n");
      }
    }

    // Cleanup
    if (existsSync(audioPath)) {
      unlinkSync(audioPath);
    }
  } catch (error) {
    console.error("Erro:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
