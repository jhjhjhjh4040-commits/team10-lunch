/*
  SEOHAE LINK AI 중계 서버 (Cloudflare Worker)

  하는 일: 앱이 보낸 질문과 안내 목록을 받아 Gemini에 묻고, {answer, ids}를 돌려준다.
  왜 필요한가: API 키를 index.html에 넣으면 누구나 볼 수 있다. 키는 이 서버의 비밀 변수에만 둔다.

  AI는 두 가지 중 있는 것을 쓴다 (둘 다 있으면 Gemini 먼저, 막히면 Cloudflare AI):
    1) Cloudflare 자체 AI : Worker 설정의 Bindings에 'Workers AI'를 변수 이름 AI로 추가 (키 필요 없음)
    2) Gemini            : Settings → Variables and Secrets 에 GEMINI_API_KEY (Secret)

  그 밖의 선택 설정 (Text):
    MODEL           Gemini 모델 이름. 비우면 아래 FALLBACK_MODELS를 차례로 시도
    AI_MODEL        Cloudflare AI 모델 이름. 비우면 아래 CF_MODELS를 차례로 시도
    ALLOWED_ORIGIN  앱 주소. 기본값은 팀 GitHub Pages
*/

const FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
/* Cloudflare 무료로 쓸 수 있는 모델. 첫 모델이 실패하면 다음 모델 */
const CF_MODELS = ['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/mistralai/mistral-small-3.1-24b-instruct'];
/* 팀이 품질을 비교해 볼 수 있게 허용한 무료 모델 (요청의 model 값이 이 목록에 있을 때만 사용) */
const CF_ALLOWED = [...CF_MODELS, '@cf/google/gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/google/gemma-3-12b-it'];
const DEFAULT_ORIGIN = 'https://jhjhjhjh4040-commits.github.io';

/* 앱의 Claude 버전과 같은 규칙. 질문·학년·목록만 받고 규칙은 서버가 붙여서, 다른 용도로 키를 쓰지 못하게 함 */
function buildPrompt({ q, grade, today, list }) {
  return `너는 서해고등학교(경기도 시흥) 학생 앱 SEOHAE LINK의 안내 도우미다. 아래 [안내 목록]에 적힌 내용만 근거로 학생의 질문에 답해라.
오늘: ${today}. 질문한 학생: ${grade}학년.

규칙:
- 목록에 없는 내용은 절대 지어내지 마라. 답이 없으면 "안내문에서 찾지 못했어요. 담임 선생님께 확인해 보세요."라고 답해라.
- "제목만 확인"이 붙은 글은 세부 내용을 모르니 원문 확인을 안내해라.
- 학년이 맞지 않는 활동은 추천하지 마라. 마감이 지난 것은 지났다고 말해라. 분류가 '학교 일정'이면 '날짜'가 그날이다.
- 해요체로 1~2문장, 40자 안팎으로 아주 짧게. 날짜는 M/D(요일). 공문투·이모지 금지.
- JSON 객체 하나만 답해라: {"answer":"답변","ids":["근거가 된 글의 id 0~3개"]}. id는 목록에 있는 것만. 글 id는 ids에만 넣고 answer 문장에는 쓰지 마라.

[안내 목록]
${list}

학생 질문: ${JSON.stringify(q)}`;
}

const json = (body, status, cors) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors } });

/* AI가 돌려준 글에서 {answer, ids}를 꺼냄.
   생각 과정·코드블록·앞뒤 설명이 섞여 있어도 "answer"가 들어간 { } 덩어리 중 마지막 것을 읽음 */
function parseAnswer(text) {
  const t = String(text || '');
  const blocks = t.match(/\{[^{}]*"answer"[^{}]*\}/g) || [];
  for (const blk of blocks.reverse()) {
    try {
      const r = JSON.parse(blk);
      if (typeof r.answer === 'string' && r.answer.replace(/[.\s…]/g, '').length >= 2)
        return { raw: t.slice(-400), answer: r.answer.trim(), ids: Array.isArray(r.ids) ? r.ids.filter(x => typeof x === 'string' && /^[a-z]\d/.test(x)).slice(0, 3) : [] };
    } catch {}
  }
  return { error: 'invalid_json', raw: t.slice(0, 300) };   // raw: 원인 확인용으로 AI가 실제로 보낸 앞부분
}

/* 응답 안의 글자를 꺼냄. 모델마다 모양이 달라서 여러 곳을 확인 */
function textOf(out) {
  const msg = out?.choices?.[0]?.message;
  let c = msg?.content ?? out?.response ?? out?.output_text ?? '';
  if (Array.isArray(c)) c = c.map(p => (typeof p === 'string' ? p : p?.text || '')).join('');
  if (!c && msg?.reasoning_content) c = msg.reasoning_content;   // 생각만 하고 답칸이 비었을 때
  return typeof c === 'string' ? c : JSON.stringify(c);
}

/* Gemini 한 번 호출. 실패하면 {error, status}를 돌려줌 */
async function callGemini(model, prompt, key) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) return { error: res.status === 429 ? 'rate_limited' : 'upstream', status: res.status };
  const data = await res.json();
  return parseAnswer((data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''));
}

/* Cloudflare 자체 AI 한 번 호출 (env.AI 연결 필요) */
async function callWorkersAI(model, prompt, ai) {
  try {
    const out = await ai.run(model, {
      messages: [
        { role: 'system', content: '한국어로 답하고, 설명 없이 JSON 객체 하나만 출력해라. answer에는 실제 답 문장을, ids에는 근거 글 id를 넣어라.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_completion_tokens: 1024,   // 생각하는 모델은 답 전에 글자를 많이 써서 넉넉하게
    });
    return parseAnswer(textOf(out));
  } catch (e) {
    /* 하루 무료 사용량(뉴런)을 넘었거나 자리가 없을 때의 오류는 '요청 많음'으로 */
    return { error: /4006|neuron|limit|capacity|3040|429/i.test(String(e?.message)) ? 'rate_limited' : 'upstream', raw: String(e?.message || '').slice(0, 200) };
  }
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'vary': 'origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ ok: true, info: 'SEOHAE LINK AI 중계 서버. POST로 질문을 보내세요.' }, 200, cors);

    /* 팀 앱 주소에서 온 요청만 받음 (브라우저 기준) */
    const from = request.headers.get('origin');
    if (from && from !== origin) return json({ error: 'forbidden_origin' }, 403, cors);
    if (!env.GEMINI_API_KEY && !env.AI) return json({ error: 'no_ai' }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400, cors); }
    const q = String(body?.q || '').trim().slice(0, 200);
    const grade = [1, 2, 3].includes(body?.grade) ? body.grade : 2;
    const today = String(body?.today || '').slice(0, 20);
    const list = String(body?.list || '');
    if (!q || !list) return json({ error: 'bad_request' }, 400, cors);
    if (list.length > 30000) return json({ error: 'too_long' }, 413, cors);

    const prompt = buildPrompt({ q, grade, today, list });
    /* 시도 순서: Gemini 모델들 → Cloudflare AI. 하나라도 성공하면 바로 답함 */
    const tries = [];
    if (env.GEMINI_API_KEY) for (const m of (env.MODEL ? [env.MODEL] : FALLBACK_MODELS)) tries.push([m, () => callGemini(m, prompt, env.GEMINI_API_KEY)]);
    const pick = CF_ALLOWED.includes(body?.model) ? [body.model] : null;
    if (env.AI) for (const m of (pick || (env.AI_MODEL ? [env.AI_MODEL] : CF_MODELS))) tries.push([m, () => callWorkersAI(m, prompt, env.AI)]);
    let last = { error: 'upstream' };
    for (const [m, run] of tries) {
      last = await run();
      if (!last.error) return json({ answer: last.answer, ids: last.ids, model: m, ...(body?.debug ? { raw: last.raw } : {}) }, 200, cors);
    }
    return json({ error: last.error, raw: last.raw }, last.error === 'rate_limited' ? 429 : 502, cors);
  },
};
