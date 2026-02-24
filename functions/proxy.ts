const API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";

// ===== CORS =====
function corsHeaders(headers?: Headers): Headers {
  const h = new Headers(headers || {});
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  h.set("Access-Control-Allow-Headers", "*");
  return h;
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// ===== 音频代理（只做最少修改）=====
async function proxyAudio(target: string, request: Request) {
  let url: URL;

  try {
    url = new URL(target);
  } catch {
    return new Response("Bad URL", { status: 400 });
  }

  const headers: any = {
    "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
  };

  // 只针对常见域名加 Referer（不强制）
  if (url.hostname.includes("kuwo")) {
    headers["Referer"] = "https://www.kuwo.cn/";
  } else if (url.hostname.includes("163")) {
    headers["Referer"] = "https://music.163.com/";
  } else if (url.hostname.includes("qq")) {
    headers["Referer"] = "https://y.qq.com/";
  }

  const range = request.headers.get("Range");
  if (range) {
    headers["Range"] = range;
  }

  let upstream;
  try {
    upstream = await fetch(url.toString(), {
      headers,
    });
  } catch {
    return new Response("Fetch failed", { status: 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: corsHeaders(upstream.headers),
  });
}

// ===== API 代理（完全透传，不解析）=====
async function proxyApi(url: URL, request: Request) {
  const apiUrl = new URL(API_BASE_URL);

  url.searchParams.forEach((value, key) => {
    if (key === "target") return;
    apiUrl.searchParams.set(key, value);
  });

  if (!apiUrl.searchParams.has("types")) {
    return new Response("Missing types", { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetch(apiUrl.toString(), {
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "*/*",
      },
    });
  } catch {
    return new Response("API failed", { status: 502 });
  }

  // ❗ 不解析 JSON，直接返回
  return new Response(upstream.body, {
    status: upstream.status,
    headers: corsHeaders(upstream.headers),
  });
}

// ===== 主入口 =====
export default {
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const target = url.searchParams.get("target");

    if (target) {
      return proxyAudio(target, request);
    }

    return proxyApi(url, request);
  },
};
