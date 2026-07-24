import type { JobSourceAdapter } from "../types";
import { apifyIndeedAdapter } from "./apify-indeed";
import { careerOneStopAdapter } from "./careeronestop";
import { jsearchAdapter } from "./jsearch";
import { usajobsAdapter } from "./usajobs";
import { adzunaAdapter } from "./adzuna";
import { remotiveAdapter } from "./remotive";
import { remoteOkAdapter } from "./remoteok";
import { weWorkRemotelyAdapter } from "./weworkremotely";
import { arbeitnowAdapter } from "./arbeitnow";
import { ashbyAdapter, greenhouseAdapter, leverAdapter } from "./ats";
import { smartRecruitersAdapter } from "./smartrecruiters";

export const ALL_JOB_SOURCE_ADAPTERS: JobSourceAdapter[] = [
  careerOneStopAdapter,
  apifyIndeedAdapter,
  remotiveAdapter,
  remoteOkAdapter,
  weWorkRemotelyAdapter,
  arbeitnowAdapter,
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  smartRecruitersAdapter,
  jsearchAdapter,
  usajobsAdapter,
  adzunaAdapter,
];

export const JOB_SOURCE_ADAPTER_BY_KEY = new Map(
  ALL_JOB_SOURCE_ADAPTERS.map((adapter) => [adapter.source, adapter]),
);

