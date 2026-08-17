#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const LESSONS_DIR = path.join(PROJECT_ROOT, "public", "lessons");
const CLOUDBASE_ENV_ID = "shangmethod-poc-d7fuug6m5e37ad8d";
const CLOUDBASE_BUCKET_ID = "shangmethod-audio";

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/upload-cloudbase-audio.mjs --dry-run");
  console.log("  node scripts/upload-cloudbase-audio.mjs --all --dry-run");
  console.log("  node scripts/upload-cloudbase-audio.mjs --all");
  console.log("  node scripts/upload-cloudbase-audio.mjs --lesson-id <lesson-id> --dry-run");
  console.log("  node scripts/upload-cloudbase-audio.mjs --lesson-id <lesson-id>");
}

function parseArgs(args) {
  let all = false;
  let dryRun = false;
  let lessonId = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--all") {
      all = true;
      continue;
    }

    if (arg === "--lesson-id") {
      lessonId = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (lessonId !== null && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(lessonId)) {
    throw new Error(`Invalid lesson ID: ${lessonId}`);
  }

  if (all && lessonId) {
    throw new Error("Use either --all or --lesson-id, not both.");
  }

  if (!dryRun && !all && !lessonId) {
    throw new Error("Real uploads require either --all or --lesson-id <lesson-id>.");
  }

  return { all, dryRun, lessonId };
}

async function findAudioFiles() {
  const entries = await readdir(LESSONS_DIR, { withFileTypes: true });
  const lessonDirectories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  const audioFiles = [];

  for (const directory of lessonDirectories) {
    const localPath = path.join(LESSONS_DIR, directory.name, "audio.mp3");

    try {
      const fileStats = await stat(localPath);
      if (!fileStats.isFile()) continue;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    audioFiles.push({
      lessonId: directory.name,
      localPath,
      objectPath: path.posix.join("lessons", directory.name, "audio.mp3"),
    });
  }

  return audioFiles;
}

async function selectAudioFiles(lessonId) {
  const audioFiles = await findAudioFiles();

  if (!lessonId) return audioFiles;

  const selectedAudio = audioFiles.find((audioFile) => audioFile.lessonId === lessonId);
  if (!selectedAudio) {
    throw new Error(`Audio file not found: public/lessons/${lessonId}/audio.mp3`);
  }

  return [selectedAudio];
}

async function createStorageClient() {
  const secretId = process.env.TENCENTCLOUD_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
  const apiKey = process.env.CLOUDBASE_API_KEY;

  if (!secretId || !secretKey) {
    throw new Error(
      "Missing TENCENTCLOUD_SECRET_ID or TENCENTCLOUD_SECRET_KEY environment variable.",
    );
  }

  if (!apiKey) {
    throw new Error("Missing CLOUDBASE_API_KEY environment variable.");
  }

  let managerModule;

  try {
    managerModule = await import("@cloudbase/manager-node");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        "Missing @cloudbase/manager-node. Install version 5.4.0 or newer before uploading.",
      );
    }
    throw error;
  }

  const CloudBase = managerModule.default;
  const manager = new CloudBase({
    secretId,
    secretKey,
    envId: CLOUDBASE_ENV_ID,
  });

  return { storage: manager.storage, apiKey };
}

async function uploadAudioFile(storage, apiKey, audioFile) {
  const audioBuffer = await readFile(audioFile.localPath);

  await storage.uploadObject({
    bucketId: CLOUDBASE_BUCKET_ID,
    objectName: audioFile.objectPath,
    body: audioBuffer,
    contentLength: audioBuffer.length,
    contentType: "audio/mpeg",
    cacheControl: "max-age=3600",
    upsert: true,
    accessToken: apiKey,
  });
}

async function publicObjectExists(storage, audioFile) {
  try {
    await storage.getObjectInfoPublic({
      bucketId: CLOUDBASE_BUCKET_ID,
      objectName: audioFile.objectPath,
    });
    return true;
  } catch (error) {
    const code = String(error?.code ?? "");
    const message = error instanceof Error ? error.message : String(error);
    const notFound = code === "HTTP_404"
      || code === "STORAGE_OBJECT_NOT_FOUND"
      || /(?:HTTP_404|not found|不存在)/i.test(message);

    if (notFound) return false;
    throw new Error(`Unable to check whether the object exists: ${message}`);
  }
}

async function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 2;
    return;
  }

  const audioFiles = await selectAudioFiles(options.lessonId);

  console.log(options.dryRun ? "CloudBase audio upload dry run" : "CloudBase audio upload");
  console.log(`Source: ${LESSONS_DIR}`);
  console.log(`Environment: ${CLOUDBASE_ENV_ID}`);
  console.log(`Bucket: ${CLOUDBASE_BUCKET_ID}`);
  console.log("");

  audioFiles.forEach((audioFile, index) => {
    console.log(`[${index + 1}/${audioFiles.length}] ${audioFile.lessonId}`);
    console.log(`  Current file: ${audioFile.localPath}`);
    console.log(`  Object path:  ${audioFile.objectPath}`);
  });

  if (options.dryRun) {
    console.log("");
    console.log("Dry run complete");
    console.log(`Total audio files scanned: ${audioFiles.length}`);
    console.log(`Upload candidates: ${audioFiles.length}`);
    console.log("Files uploaded: 0");
    return;
  }

  const { storage, apiKey } = await createStorageClient();
  let successCount = 0;
  let skippedCount = 0;
  let failureCount = 0;
  const failures = [];

  for (const audioFile of audioFiles) {
    try {
      if (options.all && await publicObjectExists(storage, audioFile)) {
        skippedCount += 1;
        console.log(`Skipped existing object: ${audioFile.objectPath}`);
        continue;
      }

      await uploadAudioFile(storage, apiKey, audioFile);
      successCount += 1;
      console.log(`Uploaded: ${audioFile.objectPath}`);
    } catch (error) {
      failureCount += 1;
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ lessonId: audioFile.lessonId, reason });
      console.error(`Upload failed: ${audioFile.objectPath}`);
      console.error(reason);
    }
  }

  console.log("");
  console.log("Upload complete");
  console.log(`Total audio files scanned: ${audioFiles.length}`);
  console.log(`Successful uploads: ${successCount}`);
  console.log(`Skipped existing objects: ${skippedCount}`);
  console.log(`Failed uploads: ${failureCount}`);

  if (failures.length > 0) {
    console.log("");
    console.log("Failures:");
    failures.forEach(({ lessonId, reason }) => {
      console.log(`- ${lessonId}: ${reason}`);
    });
  }

  if (failureCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("CloudBase audio upload failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
