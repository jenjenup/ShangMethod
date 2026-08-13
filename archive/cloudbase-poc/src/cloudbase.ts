import cloudbase from "@cloudbase/js-sdk";

const env = import.meta.env.VITE_CLOUDBASE_ENV_ID;
const region = import.meta.env.VITE_CLOUDBASE_REGION;

export const cloudbaseConfigured = Boolean(env && region);

export const app = cloudbaseConfigured
  ? cloudbase.init({ env, region })
  : null;

export const auth = app?.auth ?? null;
export const db = app?.rdb() ?? null;
