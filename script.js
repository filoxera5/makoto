
const datePicker = document.getElementById("datePicker");
const periodSelect = document.getElementById("periodSelect");
const searchBtn = document.getElementById("searchBtn");
const sortSelect = document.getElementById("sortSelect");
const newsList = document.getElementById("newsList");
const resultMeta = document.getElementById("resultMeta");

let newsData = [];
let currentResult = null;

// 한국 기준 오늘 날짜
const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

datePicker.value = today;
datePicker.max = today;

// HTML 특수문자 복원
function decodeHtml(text) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = text || "";
    return textarea.value;
}

// 숫자 표시
function formatNumber(number) {
    if (number === null || number === undefined) {
        return "미제공";
    }
    return Number(number).toLocaleString("ko-KR");
}

// 뉴스 화면 표시
function showNews() {
    newsList.replaceChildren();

    if (!currentResult || newsData.length === 0) {
        newsList.innerHTML =
            "<p>해당 기간에 수집된 뉴스가 없습니다.</p>";
        return;
    }

    const sortType = sortSelect.value;

    // 수집된 전체 영상 정렬
    const sorted = [...newsData].sort((a, b) =>
        (b[sortType] ?? -1) - (a[sortType] ?? -1)
    );

    // 상위 50개 표시
    const displayed = sorted.slice(0, 50);

    const periodName = {
        day: "일간",
        week: "주간",
        month: "월간"
    }[currentResult.period];

    resultMeta.textContent =
        `${periodName} 랭킹 | ` +
        `${currentResult.startDate} ~ ${currentResult.endDate} | ` +
        `${formatNumber(newsData.length)}개 수집 · ` +
        `상위 ${displayed.length}개 표시 · 현재 누적 통계 기준`;

    if (currentResult.incomplete) {
        resultMeta.textContent +=
            " | 수집 한도 도달: 일부 영상 기준 순위";
    }

    const fragment = document.createDocumentFragment();

    displayed.forEach((news, index) => {
        const card = document.createElement("a");
        card.className = "news-card";
        card.href =
            `https://www.youtube.com/watch?v=${encodeURIComponent(news.id)}`;
        card.target = "_blank";
        card.rel = "noopener noreferrer";

        const thumbnail = document.createElement("img");
        thumbnail.src = news.thumbnail || "";
        thumbnail.alt = decodeHtml(news.title);
        thumbnail.loading = "lazy";

        const info = document.createElement("div");
        info.className = "news-info";

        const title = document.createElement("h3");
        title.textContent =
            `${index + 1}위 · ${decodeHtml(news.title)}`;

        const channel = document.createElement("p");
        channel.textContent = news.channel;

        const views = document.createElement("p");
        views.textContent =
            `조회수: ${formatNumber(news.views)}회`;

        const comments = document.createElement("p");
        comments.textContent =
            `댓글: ${formatNumber(news.comments)}`;

        const likes = document.createElement("p");
        likes.textContent =
            `좋아요: ${formatNumber(news.likes)}`;

        const published = document.createElement("p");
        published.textContent =
            "업로드: " +
            new Date(news.publishedAt).toLocaleString(
                "ko-KR",
                {
                    timeZone: "Asia/Seoul",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit"
                }
            );

        const link = document.createElement("small");
        link.textContent = "유튜브에서 영상 보기 ↗";

        info.append(
            title, channel, views, comments,
            likes, published, link
        );

        card.append(thumbnail, info);
        fragment.appendChild(card);
    });

    newsList.appendChild(fragment);
}

// 서버에서 기간별 뉴스 가져오기
async function fetchNews() {
    const date = datePicker.value;
    const period = periodSelect.value;

    if (!date) {
        newsList.innerHTML =
            "<p>날짜를 선택해주세요.</p>";
        return;
    }

    searchBtn.disabled = true;
    sortSelect.disabled = true;
    searchBtn.textContent = "불러오는 중...";

    newsData = [];
    currentResult = null;
    resultMeta.textContent = "";
    newsList.innerHTML =
        "<p>선택한 기간의 유튜브 뉴스를 수집하고 있습니다. 월간 조회는 오래 걸릴 수 있습니다.</p>";

    try {
        const params = new URLSearchParams({
            date,
            period
        });

        const response = await fetch(
            `/api/news?${params.toString()}`
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "뉴스를 불러오지 못했습니다."
            );
        }

        currentResult = data;
        newsData = data.videos || [];

        if (newsData.length === 0) {
            resultMeta.textContent =
                data.incomplete
                    ? "수집 한도에 도달하여 일부 영상만 확인했습니다."
                    : "검색 결과 없음";

            newsList.innerHTML =
                "<p>해당 기간에 수집된 뉴스가 없습니다.</p>";
            return;
        }

        showNews();

    } catch (error) {
        console.error(error);

        newsList.replaceChildren();

        const message = document.createElement("p");
        message.textContent =
            `오류 발생: ${error.message}`;

        newsList.appendChild(message);

    } finally {
        searchBtn.disabled = false;
        sortSelect.disabled = false;
        searchBtn.textContent = "뉴스 조회";
    }
}

// 뉴스 조회 버튼
searchBtn.addEventListener("click", fetchNews);

// 정렬 변경 시 서버 호출 없이 즉시 재정렬
sortSelect.addEventListener("change", () => {
    if (currentResult) {
        showNews();
    }
});
