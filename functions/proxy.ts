const API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";

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

// ===== 工具函数 =====

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

  // 默认缓存
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

// ===== 更宽松 URL 校验（避免误杀） =====

function normalizeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

// ===== Referer 自动匹配（修复403） =====

function getReferer(host: string): string {
  if (/kuwo\.cn/.test(host)) return "https://www.kuwo.cn/";
  if (/163\.com/.test(host)) return "https://music.163.com/";
  if (/qq\.com/.test(host)) return "https://y.qq.com/";
  if (/kugou\.com/.test(host)) return "https://www.kugou.com/";
  if (/migu\.cn/.test(host)) return "https://music.migu.cn/";
  return "";
}

// ===== 音频代理 =====

async function proxyAudio(target: string, request: Request): Promise<Response> {
  if (!target || target.length > 2000) {
    return new Response("Invalid target", { status: 400 });
  }

  const url = normalizeUrl(target);
  if (!url) {
    return new Response("Bad URL", { status: 400 });
  }

  const headers: Record<string, string> = {
    "User-Agent":
      request.headers.get("User-Agent") ||
      "Mozilla/5.0",
  };

  // 动态 Referer（关键）
  const referer = getReferer(url.hostname);
  if (referer) {
    headers["Referer"] = referer;
  }

  // 支持 Range（拖动播放）
  const range = request.headers.get("Range");
  if (range) {
    headers["Range"] = range;
  }

  let upstream: Response;

  try {
    upstream = await fetch(url.toString(), {
      method: "GET",
      headers,
    });
  } catch (err) {
    return new Response("Fetch failed", { status: 502 });
  }

  const resHeaders = createCorsHeaders(upstream.headers);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

// ===== API 代理（重点修复） =====

async function proxyApi(url: URL, request: Request): Promise<Response> {
  const apiUrl = new URL(API_BASE_URL);

  // 透传参数
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
        Accept: "*/*", // 更宽松
      },
    });
  } catch {
    return json({ error: "API fetch failed" }, 502);
  }

  // ===== 关键修复：兼容非标准 JSON =====
  const text = await upstream.text();

  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    // 如果不是 JSON，直接返回原始数据（避免报错）
    return new Response(text, {
      status: upstream.status,
      headers: createCorsHeaders(upstream.headers),
    });
  }

  // ===== 自动代理播放地址（兼容各种格式） =====
  if (url.searchParams.get("types") === "url") {
    let musicUrl =
      data?.url ||
      data?.data ||
      data?.url_mp3 ||
      data?.url_flac;

    if (typeof musicUrl === "string" && musicUrl.startsWith("http")) {
      data.raw_url = musicUrl;
      data.url =
        `${url.origin}/?target=` +
        encodeURIComponent(musicUrl);
    }
  }

  return json(data, upstream.status);
}

// ===== JSON 输出 =====

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ===== 主入口 =====

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

    // 音频代理
    const target = url.searchParams.get("target");
    if (target) {
      return proxyAudio(target, request);
    }

    // API 代理
    return proxyApi(url, request);
  },
};
