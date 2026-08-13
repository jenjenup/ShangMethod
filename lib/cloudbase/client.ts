"use client";

import cloudbase from "@cloudbase/js-sdk";

const env = process.env.NEXT_PUBLIC_CLOUDBASE_ENV_ID;
const region = process.env.NEXT_PUBLIC_CLOUDBASE_REGION;

export const cloudbaseConfigured = Boolean(env && region);

export const cloudbaseApp = cloudbaseConfigured && typeof window !== "undefined"
  ? cloudbase.init({ env: env!, region: region! })
  : null;

export const cloudbaseAuth = cloudbaseApp?.auth ?? null;
export const cloudbaseDb = cloudbaseApp?.rdb() ?? null;
