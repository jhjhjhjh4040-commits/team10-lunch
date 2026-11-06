# SEOHAE LINK AI 중계 서버 올리기

GitHub Pages 앱이 AI로 답하려면 이 중계 서버가 필요해요.
흐름: 앱 → 중계 서버(Cloudflare) → AI → 앱.

AI는 둘 중 **있는 것**을 써요. 둘 다 있으면 Gemini를 먼저 쓰고, 막히면 Cloudflare AI가 대신 답해요.

| | 키 | 품질 | 비용 |
|---|---|---|---|
| **A. Cloudflare 자체 AI** | 필요 없음 | 보통 (직접 시험 필요) | 하루 무료 사용량 10,000 뉴런 |
| B. Gemini | Google AI Studio 키 필요 | 좋음 | 무료 사용량 (Google이 줄일 수 있음) |

## 1. Worker 만들기 (공통, Cloudflare 무료 계정)
1. https://dash.cloudflare.com 가입 후 로그인
2. **Workers & Pages → Create application → Hello World 템플릿**
3. 이름 `seohae-link-ai` → **Deploy**
4. **Edit code**에서 기존 코드를 모두 지우고 이 폴더의 `worker.js` 전체를 붙여 넣은 뒤 **Deploy**
5. 주소(`https://seohae-link-ai.○○○.workers.dev`)를 새 탭에서 열어 `"ok":true`가 보이는지 확인

## 2-A. Cloudflare 자체 AI 연결 (키 필요 없음)
1. Worker 화면 **Settings → Bindings → Add**
2. **Workers AI** 선택
3. Variable name에 **`AI`** (대문자 두 글자)
4. **Deploy**(또는 Save)

모델을 바꾸고 싶으면 Settings → Variables and Secrets에 Type **Text**, 이름 `AI_MODEL`, 값에 모델 이름(예: `@cf/google/gemma-4-26b-a4b-it`)을 넣어요. 비우면 `worker.js`의 기본 모델을 써요.

## 2-B. Gemini 키 연결 (선택)
1. https://aistudio.google.com → **Get API key → Create API key** (결제 연결은 하지 마세요)
2. Worker **Settings → Variables and Secrets → Add**
3. Type **Secret**, 이름 `GEMINI_API_KEY`, 값에 키 → **Deploy**
4. 키는 채팅, 카톡, GitHub에 붙여 넣지 마세요.

## 3. 앱에 주소 넣기
Worker 주소를 Claude에게 알려 주면 `index.html`의 `AI_ENDPOINT`에 넣고 다시 올려요.

## 알아 둘 점
- Cloudflare AI 무료 사용량은 하루 10,000 뉴런이고 매일 00:00(UTC, 한국 시간 오전 9시)에 초기화돼요. 넘으면 앱이 자동으로 키워드 검색 답변을 보여 줘요.
- 질문 창에 개인정보는 적지 않도록 안내해 주세요.
- 변수 이름 `AI`, `GEMINI_API_KEY`는 대소문자까지 정확히 맞춰야 해요.
