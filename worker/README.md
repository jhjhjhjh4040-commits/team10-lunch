# SEOHAE LINK AI 중계 서버 올리기

GitHub Pages 앱이 AI로 답하려면 이 중계 서버가 필요해요.
흐름: 앱 → 중계 서버(Cloudflare) → Gemini → 앱. API 키는 중계 서버에만 저장돼서 앱 코드에 드러나지 않아요.

## 1. Gemini API 키 받기 (무료)
1. https://aistudio.google.com 에 Google 계정으로 로그인
2. **Get API key → Create API key**
3. 키를 복사해 둬요. **채팅, 카톡, GitHub 파일에 절대 붙여 넣지 마세요.**
4. 결제(billing)는 연결하지 마세요. 연결하면 모든 사용량이 유료가 돼요.

## 2. Cloudflare에 중계 서버 만들기 (무료)
1. https://dash.cloudflare.com 에 가입 후 로그인
2. **Workers & Pages → Create → Create Worker**
3. 이름을 `seohae-link-ai`로 정하고 **Deploy**
4. **Edit code**를 눌러 기본 코드를 모두 지우고, 이 폴더의 `worker.js` 내용을 통째로 붙여 넣은 뒤 **Deploy**

## 3. 키 등록
1. 만든 Worker의 **Settings → Variables and Secrets → Add**
2. Type: **Secret**, Name: `GEMINI_API_KEY`, Value: 1단계에서 받은 키
3. 저장(Deploy)

선택 설정:
- `MODEL` (Text): 쓸 모델을 바꾸고 싶을 때만 지정해요. 비우면 `gemini-2.5-flash-lite`를 먼저 쓰고, 막히면 `gemini-2.5-flash`를 써요.
- `ALLOWED_ORIGIN` (Text): 앱 주소가 `https://jhjhjhjh4040-commits.github.io`가 아닐 때만 지정해요.

## 4. 앱에 주소 넣기
Worker 주소(예: `https://seohae-link-ai.○○○.workers.dev`)를 Claude에게 알려 주면, `index.html`의 `AI_ENDPOINT`에 넣고 다시 올려요.

## 알아 둘 점
- 무료 사용량은 하루 질문 수에 제한이 있고, Google이 예고 없이 줄일 수 있어요. 한도를 넘거나 AI가 실패하면 앱은 자동으로 키워드 검색 답변을 보여 줘요.
- 무료 사용분의 입력 내용은 Google 서비스 개선에 쓰일 수 있어요. 질문 창에 개인정보는 적지 않도록 안내해 주세요.
- 브라우저 주소창에 Worker 주소를 열었을 때 `"ok":true`가 보이면 서버가 살아 있는 거예요.
