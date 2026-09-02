#!/usr/bin/env node
/**
 * Probe API keys from .env.local without printing secrets.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { InferenceClient } from "@huggingface/inference";

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

function redact(text, secrets) {
  let out = String(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/hf_[A-Za-z0-9]+/g, "hf_[redacted]").slice(0, 400);
}

function summarize(value) {
  if (!value) return { present: false, length: 0, prefix: "" };
  return {
    present: true,
    length: value.length,
    prefix: value.slice(0, 3) + "…",
  };
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const text = await response.text();
  return { status: response.status, text };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function countCbs(payload) {
  if (!payload || typeof payload !== "object") return 0;
  if (Array.isArray(payload.body)) return payload.body.length;
  const disaster = payload.DisasterMsg ?? payload.DisasterMessage;
  if (Array.isArray(disaster)) {
    for (const part of disaster) {
      if (part?.row) return Array.isArray(part.row) ? part.row.length : 1;
    }
  }
  const items = payload.response?.body?.items?.item ?? payload.body?.items?.item ?? payload.row;
  if (Array.isArray(items)) return items.length;
  if (items) return 1;
  return 0;
}

const env = loadEnv(resolve(process.cwd(), ".env.local"));
const secrets = [env.DATA_GO_KR_KEY, env.SAFE182_AUTH_KEY, env.HF_TOKEN, env.SAFE182_ESNTL_ID];
const result = {
  env: {
    DATA_GO_KR_KEY: summarize(env.DATA_GO_KR_KEY),
    SAFE182_ESNTL_ID: summarize(env.SAFE182_ESNTL_ID),
    SAFE182_AUTH_KEY: summarize(env.SAFE182_AUTH_KEY),
    HF_TOKEN: summarize(env.HF_TOKEN),
  },
  checks: {},
};

const today = new Date();
const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
const key = env.DATA_GO_KR_KEY || "";
const cbsUrls = [
  `https://www.safetydata.go.kr/V2/api/DSSP-IF-00247?${new URLSearchParams({
    serviceKey: key,
    returnType: "json",
    pageNo: "1",
    numOfRows: "5",
    crtDt: ymd,
  }).toString()}`,
];

let cbsOk = false;
const cbsErrors = [];
for (const url of cbsUrls) {
  try {
    const { status, text } = await fetchText(url);
    const payload = parseJson(text);
    const n = countCbs(payload);
    const header = payload?.response?.header ?? payload?.header;
    const resultCode = header?.resultCode ?? payload?.resultCode;
    const resultMsg = header?.resultMsg ?? payload?.resultMsg ?? payload?.header?.errorMsg ?? "";
    const total = payload?.totalCount ?? payload?.response?.body?.totalCount ?? null;
    if (status === 200 && n > 0) {
      result.checks.disasterSms = { ok: true, http: status, count: n, total, endpoint: url.split("?")[0] };
      cbsOk = true;
      break;
    }
    cbsErrors.push(
      redact(
        `${url.split("?")[0]} http=${status} code=${resultCode ?? "-"} msg=${resultMsg || text.slice(0, 180)} count=${n}`,
        secrets,
      ),
    );
  } catch (error) {
    cbsErrors.push(redact(error instanceof Error ? error.message : String(error), secrets));
  }
}
if (!cbsOk) result.checks.disasterSms = { ok: false, errors: cbsErrors };

async function postForm(url, body) {
  return fetchText(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

try {
  const body = {
    esntlId: env.SAFE182_ESNTL_ID || "",
    authKey: env.SAFE182_AUTH_KEY || "",
    rowSize: "5",
    page: "1",
  };
  const amber = await postForm("https://www.safe182.go.kr/api/lcm/amberList.do", body);
  const search = await postForm("https://www.safe182.go.kr/api/lcm/findChildList.do", body);
  const amberJson = parseJson(amber.text);
  const searchJson = parseJson(search.text);
  result.checks.missing = {
    ok: Boolean(
      (amberJson && (amberJson.result === "00" || Array.isArray(amberJson.list))) ||
        (searchJson && (searchJson.result === "00" || Array.isArray(searchJson.list))),
    ),
    amber: {
      http: amber.status,
      result: amberJson?.result ?? null,
      msg: redact(amberJson?.msg ?? amber.text.slice(0, 120), secrets),
      count: Array.isArray(amberJson?.list) ? amberJson.list.length : 0,
      total: amberJson?.totalCount ?? null,
    },
    search: {
      http: search.status,
      result: searchJson?.result ?? null,
      msg: redact(searchJson?.msg ?? search.text.slice(0, 120), secrets),
      count: Array.isArray(searchJson?.list) ? searchJson.list.length : 0,
      total: searchJson?.totalCount ?? null,
    },
  };
} catch (error) {
  result.checks.missing = { ok: false, error: redact(error instanceof Error ? error.message : String(error), secrets) };
}

try {
  const client = new InferenceClient(env.HF_TOKEN);
  const models = [env.HF_MODEL || "moonshotai/Kimi-K2-Instruct", env.HF_MODEL_FALLBACK || "zai-org/GLM-5.3"];
  let hf = { ok: false, tried: [] };
  for (const model of models) {
    try {
      const completion = await client.chatCompletion({
        model,
        messages: [{ role: "user", content: 'JSON만 출력: {"ok": true}' }],
        max_tokens: 32,
        temperature: 0,
      });
      const content = completion.choices?.[0]?.message?.content ?? "";
      hf = { ok: true, model, sample: content.slice(0, 80) };
      break;
    } catch (error) {
      hf.tried.push({ model, error: redact(error instanceof Error ? error.message : String(error), secrets) });
    }
  }
  result.checks.huggingface = hf;
} catch (error) {
  result.checks.huggingface = {
    ok: false,
    error: redact(error instanceof Error ? error.message : String(error), secrets),
  };
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.checks.disasterSms?.ok && result.checks.missing?.ok && result.checks.huggingface?.ok ? 0 : 1);
