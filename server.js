
const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;


const DAY_MS = 24 * 60 * 60 * 1000;
const KST_MS = 9 * 60 * 60 * 1000;

// 방송사 목록
const channels = [
    { name: "KBS 뉴스", handle: "@newskbs" },
    { name: "MBC 뉴스", handle: "@MBCNEWS11" },
    { name: "SBS 뉴스", handle: "@sbsnews8" }
];

// 방송사당 최대 100페이지 (최대 5,000개 영상) 탐색
const MAX_PAGES = 100;

// 결과를 10분간 임시 저장
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

// 웹사이트 파일 제공
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/style.css", (req, res) => {
    res.sendFile(path.join(__dirname, "style.css"));
});

app.get("/script.js", (req, res) => {
    res.sendFile(path.join(__dirname, "script.js"));
});

// 유튜브 API 호출
async function youtubeAPI(endpoint, params) {
    const url = new URL(
        `https://www.googleapis.com/youtube/v3/${endpoint}`
    );

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    }

    url.searchParams.set(
        "key",
        process.env.YOUTUBE_API_KEY
    );

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            data.error?.message || "YouTube API 요청 실패"
        );
    }

    return data;
}

// 날짜가 올바른지 확인
function validDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }

    const parsed = new Date(`${date}T00:00:00Z`);

    return !isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date;
}

// 한국 시간 기준 날짜 문자열
function koreanDate(timestamp) {
    return new Date(timestamp + KST_MS)
        .toISOString().slice(0, 10);
}

// 방송사 영상 수집
async function getChannelVideos(channel, start, end) {
    // 채널의 업로드 재생목록 찾기
    const channelData = await youtubeAPI("channels", {
        part: "contentDetails",
        forHandle: channel.handle
    });

    const uploadsId =
        channelData.items?.[0]
            ?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsId) {
        throw new Error(
            `${channel.name}의 영상 목록을 찾을 수 없습니다.`
        );
    }

    const videos = [];
    let pageToken;
    let pages = 0;
    let truncated = false;

    // 여러 페이지를 순서대로 탐색
    while (pages < MAX_PAGES) {
        const data = await youtubeAPI("playlistItems", {
            part: "contentDetails",
            playlistId: uploadsId,
            maxResults: 50,
            pageToken
        });

        const items = data.items || [];
        pages++;

        for (const item of items) {
            const id = item.contentDetails?.videoId;
            const publishedAt =
                item.contentDetails?.videoPublishedAt;

            if (!id || !publishedAt) continue;

            const time = Date.parse(publishedAt);

            if (time >= start && time < end) {
                videos.push({
                    id,
                    channel: channel.name
                });
            }
        }

        pageToken = data.nextPageToken;

        if (!pageToken || items.length === 0) {
            break;
        }

        // 한 페이지 전체가 시작 날짜보다 과거라면 종료
        const allOlder = items.every(item => {
            const time = Date.parse(
                item.contentDetails?.videoPublishedAt || ""
            );
            return Number.isFinite(time) && time < start;
        });

        if (allOlder) {
            pageToken = undefined;
            break;
        }
    }

    if (pageToken && pages >= MAX_PAGES) {
        truncated = true;
    }

    return { videos, truncated };
}

// 날짜별 뉴스 데이터 제공
app.get("/api/news", async (req, res) => {
    try {
        const date = req.query.date;
        const period = req.query.period || "day";

        const periodDays = {
            day: 1,
            week: 7,
            month: 30
        };

        if (
            typeof date !== "string" ||
            !validDate(date) ||
            !Object.hasOwn(periodDays, period)
        ) {
            return res.status(400).json({
                error: "날짜 또는 기간 설정이 올바르지 않습니다."
            });
        }

        if (!process.env.YOUTUBE_API_KEY) {
            throw new Error(
                ".env 파일에 유튜브 API 키가 없습니다."
            );
        }

        const cacheKey = `${date}-${period}`;
        const saved = cache.get(cacheKey);

        if (saved && Date.now() - saved.time < CACHE_MS) {
            return res.json(saved.data);
        }

        const days = periodDays[period];

        // 선택 날짜의 다음 날 00시 (한국 시간)
        const end = Date.parse(
            `${date}T00:00:00+09:00`
        ) + DAY_MS;

        // 일간 1일 / 주간 7일 / 월간 30일
        const start = end - days * DAY_MS;

        console.log(
            `${period} 뉴스 수집 시작: ${date}`
        );

        // 3개 방송사 자료 수집
        const results = await Promise.all(
            channels.map(channel =>
                getChannelVideos(channel, start, end)
            )
        );

        const incomplete = results.some(
            result => result.truncated
        );

        // 중복 영상 제거
        const videoMap = new Map();

        for (const result of results) {
            for (const video of result.videos) {
                videoMap.set(video.id, video);
            }
        }

        const collected = [...videoMap.values()];
        const news = [];

        // 영상 50개씩 실제 통계 요청
        for (let i = 0; i < collected.length; i += 50) {
            const batch = collected.slice(i, i + 50);

            const data = await youtubeAPI("videos", {
                part: "snippet,statistics",
                id: batch.map(v => v.id).join(",")
            });

            for (const item of data.items || []) {
                const publishedAt = item.snippet?.publishedAt;
                const publishedTime = Date.parse(publishedAt);

                if (
                    !Number.isFinite(publishedTime) ||
                    publishedTime < start ||
                    publishedTime >= end
                ) {
                    continue;
                }

                const original = videoMap.get(item.id);
                const stats = item.statistics || {};

                news.push({
                    id: item.id,
                    title: item.snippet.title,
                    channel: original.channel,
                    publishedAt,
                    thumbnail:
                        item.snippet.thumbnails?.medium?.url ||
                        item.snippet.thumbnails?.default?.url,
                    views: Number(stats.viewCount || 0),
                    comments: stats.commentCount == null
                        ? null
                        : Number(stats.commentCount),
                    likes: stats.likeCount == null
                        ? null
                        : Number(stats.likeCount),
                    url: `https://www.youtube.com/watch?v=${item.id}`
                });
            }
        }

        const responseData = {
            date,
            period,
            startDate: koreanDate(start),
            endDate: date,
            total: news.length,
            incomplete,
            videos: news
        };

        cache.set(cacheKey, {
            time: Date.now(),
            data: responseData
        });

        // 캐시가 무한정 늘어나지 않도록 제한
        if (cache.size > 20) {
            cache.delete(cache.keys().next().value);
        }

        console.log(
            `수집 완료: ${news.length}개 영상`
        );

        res.json(responseData);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`서버 실행 성공: 포트 ${PORT}`);
});

