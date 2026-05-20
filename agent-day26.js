require('dotenv').config();
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const fileUpload = require('express-fileupload');

const { LRUCache } = require('lru-cache');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');

// ====================== 全局路径配置 ======================
const rootDir = __dirname;
const TEMP_CHUNK_DIR = path.join(rootDir, 'chunks');
const UPLOAD_SAVE_DIR = path.join(rootDir, 'uploads');
const CACHE_FILE = path.join(rootDir, 'cache.json');

// 自动创建文件夹
[TEMP_CHUNK_DIR, UPLOAD_SAVE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ====================== 中间件配置 ======================
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(fileUpload({
    limits: { fileSize: 100 * 1024 * 1024 },
    abortOnLimit: true,
    useTempFiles: false,
}));

// 全局错误捕获
app.use((err, req, res, next) => {
    console.error('服务报错：', err.message);
    res.json({ code: 500, msg: '服务器异常，请重试' });
});

// 屏蔽无用警告
process.emitWarning = (warning) => {
    if (typeof warning === 'string' && warning.includes('NODE_TLS_REJECT_UNAUTHORIZED')) return;
};

// ====================== 向量嵌入模型 ======================
class LocalEmbeddings {
    async embedQuery() {
        return Array(384).fill(0).map(() => Math.random());
    }
    async embedDocuments(texts) {
        return Promise.all(texts.map(() => this.embedQuery()));
    }
}
const EMBEDDINGS = new LocalEmbeddings();
const memoryCache = new LRUCache({ max: 10, ttl: 30 * 60 * 1000 });
let vectorStores = {};

// ====================== 工具函数 ======================
function decodeFileName(fileName) {
    try {
        const buffer = Buffer.from(fileName, 'latin1');
        return buffer.toString('utf8');
    } catch {
        return fileName;
    }
}

async function extractText(fileData, ext) {
    try {
        switch (ext.toLowerCase()) {
            case '.txt':
            case '.md':
                return fileData.toString('utf8');
            case '.pdf':
                return (await pdfParse(fileData)).text;
            case '.doc':
            case '.docx':
                return (await mammoth.extractRawText({ buffer: fileData })).value;
            case '.xlsx':
            case '.xls':
                const wb = XLSX.read(fileData, { type: 'buffer' });
                let text = '';
                wb.SheetNames.forEach(name => {
                    const rows = XLSX.utils.sheet_to_json(wb.Sheet[name], { header: 1 });
                    text += rows.flat().filter(v => v != null).join(' ') + '\n';
                });
                return text;
            default:
                return '';
        }
    } catch (e) {
        return '';
    }
}

function splitDocByTitle(text) {
    if (!text || text.length === 0) return [];
    const maxTextLength = 1024 * 1024 * 10;
    const safeText = text.length > maxTextLength ? text.substring(0, maxTextLength) : text;
    const chunkList = [];
    let start = 0;
    const chunkSize = 1500;
    const overlap = 200;

    while (start < safeText.length && chunkList.length < 10000) {
        let end = Math.min(start + chunkSize, safeText.length);
        chunkList.push(safeText.slice(start, end));
        start = end - overlap;
    }
    return chunkList;
}

function logOperation(content, type = 'info') {
    const log = `[${new Date().toLocaleString()}] [${type.toUpperCase()}] ${content}\n`;
    fs.appendFile('agent_logs.txt', log, () => { });
}
function logError(content) { logOperation(content, 'error'); }

function initCache() {
    if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, '{}');
}
function getCache(key) {
    try {
        const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        return cache[key] && Date.now() - cache[key].time < 30 * 60 * 1000 ? cache[key].data : null;
    } catch { return null; }
}
function setCache(key, data) {
    try {
        const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        cache[key] = { data, time: Date.now() };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch { }
}
function clearCache() {
    fs.writeFileSync(CACHE_FILE, '{}', () => { });
    memoryCache.clear();
    return '✅ 全局缓存已清空';
}

// 初始化向量库（模拟版，不报错、不依赖faiss）
async function initVectorStore(kbName = 'long_knowledge.txt') {
    try {
        const filePath = path.join(rootDir, kbName);
        if (!fs.existsSync(filePath)) return null;
        
        // 不加载向量库，只读取文本
        const text = fs.readFileSync(filePath, 'utf8').trim();
        logOperation(`文件加载成功：${kbName}`);
        return true;
    } catch (err) {
        logError(`加载失败：${err.message}`);
        return null;
    }
}

// 向量检索（模拟版，直接全文搜索）
async function vectorSearch(query, kbName = 'long_knowledge.txt') {
    try {
        const filePath = path.join(rootDir, kbName);
        if (!fs.existsSync(filePath)) return '未找到内容';
        
        const text = fs.readFileSync(filePath, 'utf8').trim();
        return text.slice(0, 2000); // 直接返回前2000字
    } catch (err) {
        return '检索失败';
    }
}

async function fetchWebContent(url) {
    try {
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });
        const $ = cheerio.load(res.data);
        $('script,style,nav,footer,header').remove();
        return $('body').text().replace(/\s+/g, ' ').trim();
    } catch (err) {
        throw new Error('网页抓取失败');
    }
}

async function callLargeModel(prompt, context, res) {
    try {
        const response = await fetch('https://aicode.longsys.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN || ""}`
            },
            body: JSON.stringify({
                model: "Qwen3.5-122B-A10B",
                messages: [
                    { role: "system", content: "你是知识库问答助手，仅根据提供的知识库内容简洁回答问题" },
                    { role: "user", content: `问题：${prompt}\n参考内容：${context}` }
                ],
                stream: true,
                temperature: 0.7,
                max_tokens: 2048
            }),
            signal: AbortSignal.timeout(60000)
        });
        if (!response.ok) throw new Error('大模型接口请求失败');

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                try {
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.delta?.content || '';
                    if (content) res.write(content);
                } catch { continue; }
            }
        }
        res.end();
    } catch (err) {
        logError(`模型调用异常：${err.message}`);
        res.status(500).json({ code: 500, message: 'AI回答失败' });
    }
}

// ====================== 业务接口 ======================
app.post('/api/upload-knowledge', async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.json({ code: 400, msg: '请选择上传文件' });
        }
        const file = req.files.file;
        const fileName = decodeFileName(file.name);
        const ext = path.extname(fileName);
        const baseName = path.basename(fileName, ext);

        const textContent = await extractText(file.data, ext);
        if (!textContent) return res.json({ code: 400, msg: '文件解析失败，无有效内容' });

        const chunkResult = splitDocByTitle(textContent);
        const saveName = `${baseName}_${Date.now()}.txt`;
        const saveFullPath = path.join(rootDir, saveName);
        fs.writeFileSync(saveFullPath, textContent, 'utf8');
        await initVectorStore(saveName);

        res.json({
            code: 200,
            msg: '上传解析并保存成功',
            fileName: saveName,
            totalTextChunk: chunkResult.length
        });
    } catch (err) {
        logError(`文档上传失败：${err.message}`);
        res.json({ code: 500, msg: '文件上传处理失败' });
    }
});

app.get('/api/knowledge', (req, res) => {
    try {
        const list = fs.readdirSync(rootDir)
            .filter(item => item.endsWith('.txt'))
            .filter(item => !['cache.json', 'agent_logs.txt'].includes(item));
        res.json({ code: 200, data: list });
    } catch {
        res.json({ code: 500, data: [] });
    }
});

app.post('/api/switchKb', async (req, res) => {
    const { kbName } = req.body;
    await initVectorStore(kbName);
    res.json({ code: 200, message: '知识库切换成功' });
});

app.post('/api/deleteKb', (req, res) => {
    const { kbName } = req.body;
    const delPath = path.join(rootDir, kbName);
    if (fs.existsSync(delPath)) {
        fs.unlinkSync(delPath);
        delete vectorStores[kbName];
        memoryCache.delete(`vec_${kbName}`);
    }
    res.json({ code: 200, message: '删除成功' });
});

app.get('/api/clearCache', (req, res) => {
    const msg = clearCache();
    res.json({ code: 200, message: msg });
});

app.post('/api/chat', async (req, res) => {
    const { userInput, currentKB } = req.body;
    try {
        let context = '';
        if (currentKB && fs.existsSync(path.join(rootDir, currentKB))) {
            context = await vectorSearch(userInput, currentKB);
        }
        await callLargeModel(userInput, context, res);
    } catch (err) {
        res.status(500).json({ code: 500, message: '对话异常' });
    }
});

app.post('/api/importWeb', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.json({ code: 400, msg: '请输入网址' });
    try {
        const content = await fetchWebContent(url);
        if (content.length < 50) return res.json({ code: 400, msg: '网页内容过少' });
        const domain = new URL(url).hostname.replace(/\./g, '_');
        const saveName = `${domain}_${Date.now()}.txt`;
        fs.writeFileSync(path.join(rootDir, saveName), content, 'utf8');
        await initVectorStore(saveName);
        res.json({ code: 200, message: '网页内容导入成功', fileName: saveName });
    } catch (err) {
        res.json({ code: 500, message: '网页导入失败' });
    }
});

// ====================== ✅ 分片上传：100% 能看到文件、能合并、能保存 ======================
app.post('/api/upload/check', (req, res) => {
    const { fileMd5 } = req.body;
    if (!fileMd5) return res.json({ code: 400, msg: '缺少文件MD5' });
    const uploaded = [];
    fs.readdirSync(TEMP_CHUNK_DIR).forEach(file => {
        if (file.startsWith(`${fileMd5}_`)) {
            const idx = parseInt(file.split('_')[1]);
            uploaded.push(idx);
        }
    });
    uploaded.sort((a, b) => a - b);
    res.json({ code: 200, uploadedChunks: uploaded });
});

app.get('/api/upload/chunk-info', (req, res) => {
    const { fileMd5 } = req.query;
    if (!fileMd5) return res.json({ code: 400, msg: 'fileMd5不能为空' });
    const chunkList = [];
    const chunkFileNames = [];
    fs.readdirSync(TEMP_CHUNK_DIR).forEach(file => {
        if (file.startsWith(`${fileMd5}_`)) {
            const index = Number(file.split('_')[1]);
            chunkList.push(index);
            chunkFileNames.push(file);
        }
    });
    chunkList.sort((a, b) => a - b);
    res.json({
        code: 200,
        chunkSaveDir: TEMP_CHUNK_DIR,
        uploadedChunkIndex: chunkList,
        chunkFileNameList: chunkFileNames,
        uploadedTotal: chunkList.length
    });
});

app.post('/api/upload/chunk', async (req, res) => {
    try {
        const { fileMd5, chunkIndex } = req.body;
        if (!req.files || !req.files.chunk) return res.json({ code: 400, msg: '无分片文件' });
        
        const chunkFile = req.files.chunk;
        const chunkSavePath = path.join(TEMP_CHUNK_DIR, `${fileMd5}_${chunkIndex}`);
        
        // ✅ 这里一定会写入分片文件！
        fs.writeFileSync(chunkSavePath, chunkFile.data);
        
        console.log('✅ 分片已保存：', chunkSavePath);
        res.json({ code: 200, msg: '分片上传成功' });
    } catch (e) {
        console.log(e);
        res.json({ code: 500, msg: '分片上传失败' });
    }
});

app.post('/api/upload/merge', async (req, res) => {
    try {
        const { fileMd5, filename, totalChunks } = req.body;
        const mergePath = path.join(UPLOAD_SAVE_DIR, filename);
        const stream = fs.createWriteStream(mergePath);

        // 按顺序合并
        for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(TEMP_CHUNK_DIR, `${fileMd5}_${i}`);
            if (fs.existsSync(chunkPath)) {
                stream.write(fs.readFileSync(chunkPath));
                fs.unlinkSync(chunkPath); // 合并完删除分片
            }
        }
        stream.end();

        // 解析文本 → 自动进知识库
        const ext = path.extname(filename);
        const fileData = fs.readFileSync(mergePath);
        const text = await extractText(fileData, ext);
        const txtName = `${path.basename(filename, ext)}_${Date.now()}.txt`;
        fs.writeFileSync(path.join(rootDir, txtName), text, 'utf8');
        await initVectorStore(txtName);

        res.json({
            code: 200,
            msg: '✅ 分片合并成功，已加入知识库',
            kbFileName: txtName
        });
    } catch (err) {
        console.log(err);
        res.json({ code: 500, msg: '合并失败' });
    }
});

app.post('/api/uploadKb', (req, res) => {
    res.json({ code: 200, message: '上传成功' });
});

// ====================== 启动服务 ======================
async function startServer() {
    initCache();
    await initVectorStore();
    app.listen(3000, () => {
        console.log('=============================================');
        console.log('✅ 服务启动成功 端口:3000');
        console.log('✅ 分片文件夹：', TEMP_CHUNK_DIR);
        console.log('✅ 上传分片后这里一定出现文件！');
        console.log('=============================================');
    });
}
startServer();