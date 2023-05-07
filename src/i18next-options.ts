import i18next from "i18next";
import { FsBackendOptions } from "i18next-fs-backend";

import settings from "./settings.js";

export const options: i18next.InitOptions<FsBackendOptions> = {
  debug: true,
  initImmediate: false,
  lng: settings.language,
  fallbackLng: "en",
  ns: "fluid-queue",
  defaultNS: "fluid-queue",
  saveMissing: true,
};
