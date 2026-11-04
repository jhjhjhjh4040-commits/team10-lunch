/*
  SEOHAE LINK AI 중계 서버 (Cloudflare Worker)

  하는 일: 앱이 보낸 질문과 안내 목록을 받아 Gemini에 묻고, {answer, ids}를 돌려준다.
  왜 필요한가: API 키를 index.html에 넣으면 누구나 볼 수 있다. 키는 이 서버의 비밀 변수에만 둔다.

  Cloudflare 설정(Settings → Variables and Secrets):
    GEMINI_API_KEY  (Secret, 필수)  Google AI Studio에서 받은 키
    MODEL           (Text, 선택)    쓸 모델 이름. 비우면 아래 FALLBACK_MODELS를 차례로 시도
    ALLOWED_ORIGIN  (Text, 선택)    앱 주소. 기본값은 팀 GitHub Pages
*/

const FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
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
- JSON 객체 하나만 답해라: {"answer":"답변","ids":["근거가 된 글의 id 0~3개"]}. id는 목록에 있는 것만.

[안내 목록]
${list}

학생 질문: ${JSON.stringify(q)}`;
}

const json = (body, status, cors) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors } });

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
  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  try {
    const r = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
    if (typeof r.answer !== 'string' || !r.answer.trim()) return { error: 'invalid_json' };
    return { answer: r.answer.trim(), ids: Array.isArray(r.ids) ? r.ids.filter(x => typeof x === 'string').slice(0, 3) : [] };
  } catch {
    return { error: 'invalid_json' };
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
    if (!env.GEMINI_API_KEY) return json({ error: 'no_key' }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400, cors); }
    const q = String(body?.q || '').trim().slice(0, 200);
    const grade = [1, 2, 3].includes(body?.grade) ? body.grade : 2;
    const today = String(body?.today || '').slice(0, 20);
    const list = String(body?.list || '');
    if (!q || !list) return json({ error: 'bad_request' }, 400, cors);
    if (list.length > 30000) return json({ error: 'too_long' }, 413, cors);

    const prompt = buildPrompt({ q, grade, today, list });
    const models = env.MODEL ? [env.MODEL] : FALLBACK_MODELS;
    let last = { error: 'upstream' };
    for (const m of models) {
      last = await callGemini(m, prompt, env.GEMINI_API_KEY);
      if (!last.error) return json({ ...last, model: m }, 200, cors);
      if (last.error === 'invalid_json') break;   // 모델은 답했지만 형식이 틀림 → 다른 모델 대신 앱의 검색 답변으로
    }
    return json({ error: last.error }, last.error === 'rate_limited' ? 429 : 502, cors);
  },
};
