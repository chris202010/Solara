const API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";

/**
 * 创建 CORS 头（完全放开）
 */
function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

/**
 * 处理 OPTIONS
 */
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

/**
 * 判断是否 JSONP
 */
function isJsonp(text: string) {
  return /^\w+\(.*\)$/.test(text);
}

/**
 * 去掉 JSONP 包装
 */
function stripJsonp(text: string) {
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start !== -1 && end !== -1) {
    return text.slice(start + 1, end);
  }
  return text;
}

/**
 * API代理（重点）
 */
async function proxyApi(request: Request, url: URL) {
  const apiUrl = new URL(API_BASE_URL);

  // 🔥 不再过滤参数（避免问题）
  url.searchParams.forEach((v, k) => {
    apiUrl.searchParams.set(k, v);
  });

  // 必须有 types
  if (!apiUrl.searchParams.get("types")) {
    return new Response("Missing types", { status: 400 });
  }

  const res = await fetch(apiUrl.toString(), {
    headers: {
      // 🔥 必须伪装浏览器
      "User-Agent":
        request.headers.get("User-Agent") ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Referer": "https://music.163.com/",
      "Accept": "*/*",
    },
  });

  let text = await res.text();

  // 🔥 处理 JSONP
  if (isJsonp(text)) {
    text = stripJsonp(text);
  }

  return new Response(text, {
    status: res.status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/**
 * 音频代理（兼容跳转）
 */
async function proxyAudio(request: Request, url: URL) {
  const target = url.searchParams.get("target");
  if (!target) {
    return new Response("Missing target", { status: 400 });
  }

  const res = await fetch(target, {
    method: request.method,
    headers: {
      "User-Agent":
        request.headers.get("User-Agent") ||
        "Mozilla/5.0",
      "Referer": "https://music.163.com/",
      "Range": request.headers.get("Range") || "",
    },
    redirect: "follow", // 🔥 关键：允许跳转
  });

  return new Response(res.body, {
    status: res.status,
    headers: {
      ...corsHeaders(),
      "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Content-Length": res.headers.get("Content-Length") || "",
      "Content-Range": res.headers.get("Content-Range") || "",
    },
  });
}

/**
 * 主入口
 */
export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    const url = new URL(request.url);

    // 音频代理
    if (url.searchParams.get("target")) {
      return proxyAudio(request, url);
    }

    // API代理
    return proxyApi(request, url);
  },
};
