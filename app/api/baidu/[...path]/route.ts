import { getServerSideConfig } from "@/app/config/server";
import {
  BAIDU_BASE_URL,
  ApiPath,
  DEFAULT_MODELS,
  ModelProvider,
} from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../auth";
import { collectModelTable } from "@/app/utils/model";

const serverConfig = getServerSideConfig();

const ALLOWD_PATH = new Set([""]);

async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[Baidu Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const subpath = params.path.join("/");

  //   if (!ALLOWD_PATH.has(subpath)) {
  //     console.log("[Baidu Route] forbidden path ", subpath);
  //     return NextResponse.json(
  //       {
  //         error: true,
  //         msg: "you are not allowed to request " + subpath,
  //       },
  //       {
  //         status: 403,
  //       },
  //     );
  //   }

  const authResult = auth(req, ModelProvider.Ernie);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  try {
    const response = await request(req);
    return response;
  } catch (e) {
    console.error("[Baidu] ", e);
    return NextResponse.json(prettyObject(e));
  }
}

export const GET = handle;
export const POST = handle;

export const runtime = "edge";
export const preferredRegion = [
  "arn1",
  "bom1",
  "cdg1",
  "cle1",
  "cpt1",
  "dub1",
  "fra1",
  "gru1",
  "hnd1",
  "iad1",
  "icn1",
  "kix1",
  "lhr1",
  "pdx1",
  "sfo1",
  "sin1",
  "syd1",
];

async function request(req: NextRequest) {
  const controller = new AbortController();

  let path = `${req.nextUrl.pathname}`.replaceAll(ApiPath.Baidu, "");

  let baseUrl = serverConfig.baiduUrl || serverConfig.baseUrl || BAIDU_BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  console.log("[Proxy] ", path);
  console.log("[Base Url]", baseUrl);

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );

  const access_token = await getAccessToken();
  const fetchUrl = `${baseUrl}${path}?access_token=${access_token}`;

  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
    },
    method: req.method,
    body: req.body,
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  // #1815 try to refuse some request to some models
  if (serverConfig.customModels && req.body) {
    try {
      const modelTable = collectModelTable(
        DEFAULT_MODELS,
        serverConfig.customModels,
      );
      const clonedBody = await req.text();
      fetchOptions.body = clonedBody;

      const jsonBody = JSON.parse(clonedBody) as { model?: string };

      // not undefined and is false
      if (modelTable[jsonBody?.model ?? ""].available === false) {
        return NextResponse.json(
          {
            error: true,
            message: `you are not allowed to use ${jsonBody?.model} model`,
          },
          {
            status: 403,
          },
        );
      }
    } catch (e) {
      console.error(`[Baidu] filter`, e);
    }
  }
  console.log("[Baidu request]", fetchOptions.headers, req.method);
  try {
    const res = await fetch(fetchUrl, fetchOptions);

    console.log("[Baidu response]", res.status, "   ", res.headers, res.url);
    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 使用 AK，SK 生成鉴权签名（Access Token）
 * @return string 鉴权签名信息（Access Token）
 */
async function getAccessToken() {
  const AK = serverConfig.baiduApiKey;
  const SK = serverConfig.baiduSecretKey;
  const res = await fetch(
    "https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=" +
      AK +
      "&client_secret=" +
      SK,
    {
      method: "POST",
    },
  );
  const resJson = await res.json();
  return resJson.access_token;
}
