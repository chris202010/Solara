const API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";

// 允许的音源域名（防 SSRF）
const ALLOWED_HOSTS = [
  /(^|\.)kuwo\.cn$/i,
  /(^|\.)music\.163\.com$/i,
  /(^|\.)qq\.com$/i,
  /(^|\.)kugou\.com$/i,
  /(^|\.)migu\.cn$/i,
];

// 允许透传的响应头
const SAFE_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "accept-ranges",
  "content-length",
  "content-range",
  "etag",
  "last-modified",
  "expires",
];

// ====== 工具函数 ======

function createCorsHeaders(init?: Headers): Headers {
  const headers = new Headers();

  if (init) {
    for (const [k, v] of init.entries()) {
      if (SAFE_RESPONSE_HEADERS.includes(k.toLowerCase())) {
        headers.set(k, v);
      }
    }
  }

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "*");

  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=3600");
  }

  return headers;
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: createCorsHeaders(),
  });
}

// 校验域名
function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.some((r) => r.test(host));
}

// URL 校验
function normalizeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    if (!isAllowedHost(url.hostname)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

// 根据平台设置 Referer
function getReferer(host: string): string {
  if (host.includes("kuwo.cn")) return "https://www.kuwo.cn/";
  if (host.includes("music.163.com")) return "https://music.163.com/";
  if (host.includes("qq.com")) return "https://y.qq.com/";
  if (host.includes("kugou.com")) return "https://www.kugou.com/";
  if (host.includes("migu.cn")) return "https://music.migu.cn/";
  return "";
}

// ====== 音频代理 ======

async function proxyAudio(target: string, request: Request): Promise<Response> {
  if (target.length > 1000) {
    return new Response("Invalid target", { status: 400 });
  }

  const url = normalizeUrl(target);
  if (!url) {
    return new Response("Invalid target", { status: 400 });
  }

  const headers: Record<string, string> = {
    "User-Agent":
      request.headers.get("User-Agent") ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  };

  const referer = getReferer(url.hostname);
  if (referer) {
    headers["Referer"] = referer;
  }

  // 支持 Range（关键）
  const range = request.headers.get("Range");
  if (range) {
    headers["Range"] = range;
  }

  let upstream: Response;

  try {
    upstream = await fetch(url.toString(), {
      method: "GET",
      headers,
      cf: {
        cacheTtl: 3600,
        cacheEverything: true,
      },
    });
  } catch {
    return new Response("Upstream fetch failed", { status: 502 });
  }

  const resHeaders = createCorsHeaders(upstream.headers);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

// ====== API 代理 ======

async function proxyApi(url: URL, request: Request): Promise<Response> {
  const apiUrl = new URL(API_BASE_URL);

  url.searchParams.forEach((value, key) => {
    if (key === "target" || key === "callback") return;
    apiUrl.searchParams.set(key, value);
  });

  if (!apiUrl.searchParams.has("types")) {
    return json({ error: "Missing types" }, 400);
  }

  let upstream: Response;

  try {
    upstream = await fetch(apiUrl.toString(), {
      headers: {
        "User-Agent":
          request.headers.get("User-Agent") ||
          "Mozilla/5.0",
        Accept: "application/json",
      },
      cf: {
        cacheTtl: 600,
        cacheEverything: true,
      },
    });
  } catch {
    return json({ error: "API request failed" }, 502);
  }

  let data: any;

  try {
    data = await upstream.json();
  } catch {
    return json({ error: "Invalid JSON from API" }, 502);
  }

  // 自动代理 URL（关键功能）
  if (url.searchParams.get("types") === "url" && data.url) {
    data.raw_url = data.url;
    data.url =
      `${url.origin}/?target=` + encodeURIComponent(data.url);
  }

  return json(data, upstream.status);
}

// ====== JSON 工具 ======

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ====== 防滥用（可选） ======

function checkAuth(url: URL): boolean {
  // 可选：加 token
  // return url.searchParams.get("token") === "your-secret";

  return true;
}

// ====== 主入口 ======

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    // 限制方法
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 防滥用
    if (!checkAuth(url)) {
      return new Response("Forbidden", { status: 403 });
    }

    // 音频代理
    const target = url.searchParams.get("target");
    if (target) {
      return proxyAudio(target, request);
    }

    // API 代理
    return proxyApi(url, request);
  },
};
