"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import { CloudBaseDictationSyncPrompt } from "./cloudbase-dictation-sync-prompt";
import { CloudBaseLearningRecordsSyncPrompt } from "./cloudbase-learning-records-sync-prompt";
import { CloudBaseVocabularySyncPrompt } from "./cloudbase-vocabulary-sync-prompt";

type SyncStage = "vocabulary" | "learning-records" | "dictation" | "complete";

export function CloudBaseSyncOrchestrator() {
  const { user, loading } = useAuth();
  const [stage, setStage] = useState<SyncStage>("vocabulary");

  useEffect(() => {
    setStage("vocabulary");
  }, [user?.id]);

  const showLearningRecords = useCallback(() => {
    setStage("learning-records");
  }, []);
  const showDictation = useCallback(() => {
    setStage("dictation");
  }, []);
  const finish = useCallback(() => {
    setStage("complete");
  }, []);

  if (loading || !user) return null;

  if (stage === "vocabulary") {
    return <CloudBaseVocabularySyncPrompt onComplete={showLearningRecords} />;
  }
  if (stage === "learning-records") {
    return <CloudBaseLearningRecordsSyncPrompt onComplete={showDictation} />;
  }
  if (stage === "dictation") {
    return <CloudBaseDictationSyncPrompt onComplete={finish} />;
  }
  return null;
}
