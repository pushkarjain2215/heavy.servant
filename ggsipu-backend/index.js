const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

// const { loadCredits } = require("../analytics/creditLoader");
// const { calculateAnalytics } = require("../analytics/cgpaCalculator");

const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 9999;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();

// CORS: use CORS_ORIGIN whitelist if set; otherwise allow any origin (so frontend works without env)
const corsOptions = isProduction && process.env.CORS_ORIGIN
    ? { origin: process.env.CORS_ORIGIN.split(",").map((o) => o.trim()), credentials: false }
    : { origin: true };
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// Health check for load balancers and orchestrators
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/", (req, res) => {
    res.json({ message: "API is running", health: "/health" });
});

// // load credits once
// const creditMap = loadCredits("../analytics/credits.csv");

// ---------- INIT LOGIN (CAPTCHA) ----------
app.get("/init-login", async (req, res) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        await page.goto("https://examweb.ggsipu.ac.in/web/login.jsp", {
            waitUntil: "networkidle",
        });

        await page.waitForSelector("#captchaImage");
        const captchaElement = await page.$("#captchaImage");
        const captchaBuffer = await captchaElement.screenshot();

        res.json({
            captcha: captchaBuffer.toString("base64"),
        });
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: err.message });
        }
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
});

// ---------- LOGIN + RESULT + ANALYTICS ----------
app.post("/submit-login", async (req, res) => {
    let browser;
    const { username, password, captcha } = req.body || {};

    if (!username || !password || !captcha) {
        return res.status(400).json({
            success: false,
            message: "Missing required fields: username, password, captcha",
        });
    }

    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        await page.goto("https://examweb.ggsipu.ac.in/web/login.jsp", {
            waitUntil: "networkidle",
        });

        // login
        await page.fill("#username", username);
        await page.fill("#passwd", password);
        await page.fill("#captcha", captcha);
        await page.click(".btn-login");

        await page.waitForURL("**/studenthome.jsp", { timeout: 15000 });

        // select ALL semesters
        await page.waitForSelector("#euno");
        await page.selectOption("#euno", "100");

        // get result
        await page.click(".btn-submit");
        await page.waitForSelector("table.modern-table");

        // scrape result - FIXED VERSION
        const scraped = await page.evaluate(() => {
            const studentInfo = {};
            document
                .querySelectorAll(".student-info-card .info-item")
                .forEach((i) => {
                    const k = i.querySelector(".info-label")?.innerText.trim();
                    const v = i.querySelector(".info-value")?.innerText.trim();
                    if (k && v) studentInfo[k] = v;
                });

            const subjects = Array.from(
                document.querySelectorAll("table.modern-table tbody tr"),
            ).map((row) => {
                const cells = row.querySelectorAll("td");

                // Extract text content from each cell
                const semester = cells[0]?.innerText.trim() || "";
                const paperCode = cells[1]?.innerText.trim() || "";
                const subjectName = cells[2]?.innerText.trim() || "";
                const internal = cells[3]?.innerText.trim() || "0";
                const external = cells[4]?.innerText.trim() || "0";
                const total = cells[5]?.innerText.trim() || "0";
                const exam = cells[6]?.innerText.trim() || "";
                const declaredDate = cells[7]?.innerText.trim() || "";

                console.log("Scraped row:", {
                    semester,
                    paperCode,
                    subjectName,
                    internal,
                    external,
                    total,
                });

                return {
                    semester,
                    paperCode,
                    subjectName,
                    internal,
                    external,
                    total,
                    exam,
                    declaredDate,
                };
            });

            console.log("Total subjects scraped:", subjects.length);
            return { studentInfo, subjects };
        });

        console.log("Backend received subjects:", scraped.subjects);

        // ---------- ANALYTICS ----------
        // const analytics = calculateAnalytics(scraped.subjects, creditMap);

        res.json({
            success: true,
            message: "Result fetched successfully",
            studentInfo: scraped.studentInfo,
            // analytics,
        });
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: err.message });
        }
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
});

// Global error handler (unhandled errors in route handlers)
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error("Unhandled error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
});

const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || "development"})`);
});

// Graceful shutdown
function shutdown(signal) {
    console.log(`${signal} received, closing server`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
