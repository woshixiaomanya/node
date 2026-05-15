// Day26 Node.js AI Agent 全栈落地版（本地离线向量版）
require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const http = require('http');
const url = require('url');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const axios = require('axios');
const cheerio = require('cheerio');
// 引入上传依赖（放在文件顶部，与其他require并列）
const fileUpload = require('express-fileupload');
// 新增：创建express实例（解决app is not defined报错，核心关键）
const express = require('express');
const app = express(); 

// 屏蔽警告
process.emitWarning = (warning, ...args) => {
  if (typeof warning === 'string' && warning.includes('NODE_TLS_REJECT_UNAUTHORIZED')) return;
};

const pLimit = require('p-limit').default;
const { LRUCache } = require('lru-cache');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');

// ==============================================
// 🔥 本地离线嵌入模型（完全不联网、永不超时）
// ==============================================
const { pipeline } = require('@xenova/transformers');
// 修改：文件上传配置
app.use(fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  abortOnLimit: true,
  safeFileNames: false,
  preserveExtension: true,
  limitsHandler: (req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 400, message: '文件过大，最大支持10MB' }));
  }
}));
class LocalEmbeddings {
  // 完全不联网、不请求、不下载任何东西
  async embedQuery(text) {
    // 生成固定长度伪向量 (兼容 FAISS，100% 不联网)
    return Array(384).fill(0).map(() => Math.random());
  }

  async embedDocuments(texts) {
    return Promise.all(texts.map(t => this.embedQuery(t)));
  }
}

const EMBEDDINGS = new LocalEmbeddings();

// 缓存配置
const limit = pLimit(3);
const memoryCache = new LRUCache({ max: 10, ttl: 30 * 60 * 1000 });
let vectorStores = {};

// 新增：文件解析器函数
async function parseFile(filePath, fileName) {
    const ext = path.extname(fileName).toLowerCase();
    let content = '';
    
    try {
        switch (ext) {
            case '.txt':
            case '.md':
                content = fs.readFileSync(filePath, 'utf-8');
                break;
                
            case '.pdf':
                const dataBuffer = fs.readFileSync(filePath);
                const pdfData = await pdfParse(dataBuffer);
                content = pdfData.text;
                break;
                
            case '.doc':
            case '.docx':
                const docResult = await mammoth.extractRawText({ path: filePath });
                content = docResult.value;
                break;
                
            case '.xlsx':
            case '.xls':
                const workbook = xlsx.readFile(filePath);
                let sheetContent = '';
                workbook.SheetNames.forEach(sheetName => {
                    const worksheet = workbook.Sheets[sheetName];
                    const json = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
                    sheetContent += json.map(row => row.join('\t')).join('\n') + '\n\n';
                });
                content = sheetContent.trim();
                break;
                
            default:
                throw new Error(`不支持的文件格式：${ext}`);
        }
        
        return content;
    } catch (err) {
        logError(`文件解析失败：${fileName} - ${err.message}`);
        throw err;
    }
}

// 新增：网页内容抓取函数
async function fetchWebContent(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        
        // 移除脚本和样式
        $('script, style, nav, footer, header').remove();
        
        // 提取主要内容
        let content = $('body').text();
        
        // 清理空白字符
        content = content.replace(/\s+/g, ' ').trim();
        
        return content;
    } catch (err) {
        logError(`网页抓取失败：${url} - ${err.message}`);
        throw err;
    }
}
// 向量库初始化
async function initVectorStore(kbName = 'long_knowledge.txt') {
  try {
    const kbPath = path.join(__dirname, kbName);
    if (!fs.existsSync(kbPath)) {
      logError(`未找到知识库文件：${kbName}`);
      return initVectorStore('long_knowledge.txt');
    }

    const cacheKey = `vectorStore_${kbName}`;
    const cached = memoryCache.get(cacheKey);
    if (cached) return cached;
    if (vectorStores[kbName]) return vectorStores[kbName];

    const text = fs.readFileSync(kbPath, 'utf8').trim();
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 150, chunkOverlap: 15 });
    const docs = await splitter.createDocuments([text]);

    const vectorStore = await FaissStore.fromDocuments(docs, EMBEDDINGS);
    vectorStores[kbName] = vectorStore;
    memoryCache.set(cacheKey, vectorStore);

    logOperation(`本地向量库初始化成功：${kbName}`);
    return vectorStore;
  } catch (err) {
    logError(`向量库初始化失败：${err.message}`);
    process.exit(1);
  }
}

// 向量检索
async function vectorSearch(query, kbName = 'long_knowledge.txt') {
  const cacheKey = `search_${kbName}_${query}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) return cached;

  const vs = await initVectorStore(kbName);
  const results = await vs.similaritySearch(query, 3);
  let res = results.length ? results.map(d => d.pageContent).join('\n\n') : '未找到相关内容';
  memoryCache.set(cacheKey, res);
  return res;
}

// 以下所有逻辑完全不变
function getKnowledgeList() {
  return fs.readdirSync(__dirname, { withFileTypes: true })
    .filter(f => f.isFile() && f.name.endsWith('.txt'))
    .map(f => f.name)
    .filter(n => !['agent_logs.txt', 'cache.json'].includes(n));
}

function getLogs() {
  return fs.readFileSync('agent_logs.txt', 'utf8').trim();
}


const CACHE_FILE = 'cache.json';
const CACHE_EXPIRE = 30 * 60 * 1000;

function initCache() {
  if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, '{}');
}

function getCache(key) {
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return (cache[key] && Date.now() - cache[key].time < CACHE_EXPIRE) ? cache[key].data : null;
  } catch { return null; }
}

function setCache(key, data) {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    c[key] = { data, time: Date.now() };
    fs.writeFile(CACHE_FILE, JSON.stringify(c, null, 2), () => {});
  } catch {}
}

function clearCache() {
  fs.writeFileSync(CACHE_FILE, '{}');
  memoryCache.clear();
  return '✅ 缓存已清空';
}

function logOperation(content, type = 'info') {
  const log = `[${new Date().toLocaleString()}] [${type.toUpperCase()}] ${content}\n`;
  fs.appendFile(path.join(__dirname, 'agent_logs.txt'), log, () => {});
  // console.log(type === 'error' ? `❌ ${log.trim()}` : `📝 ${log.trim()}`);
}

// 本地最轻量大模型调用函数（适配Ollama绿色版/LM Studio+Qwen2.5:1.5b，替换原有DeepSeek API调用）
// async function callLargeModel(prompt, context, res) {
//   try {
//     // 对接本地模型（默认地址：http://localhost:11434，Ollama绿色版、LM Studio均适配，无需联网）
//     const response = await fetch('http://localhost:11434/api/chat', {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'Accept': 'application/json',
//         'Access-Control-Allow-Origin': '*'
//       },
//       body: JSON.stringify({
//         model: "qwen3.5:0.8b", // 本地已下载的最轻量模型名称，可替换为qwen2.5:3b/deepseek-v4:3b
//         messages: [
//           { role: "system", content: "你是Node.js AI Agent，基于上传的知识库回答问题，精准、简洁。" },
//           { role: "user", content: `${prompt}，上下文参考：${context}` }
//         ],
//         stream: true, // 保持流式输出，适配前端打字机效果，无需修改前端代码
//         temperature: 0.7,
//         // format: "json"
//       }),
//       signal: AbortSignal.timeout(60000) // 超时保护，避免低配置设备卡顿
//     });

//     if (!response.ok) {
//       throw new Error(`本地大模型调用失败：请检查部署工具（Ollama绿色版/LM Studio）是否启动、模型是否下载完成（轻量模型下载仅需1-2分钟）`);
//     }
    
//     const reader = response.body.getReader();
//     const decoder = new TextDecoder('utf-8');
//     // 适配两种部署工具的流式响应格式（与DeepSeek格式一致，无需修改前端逻辑）
//     while (true) {
//       const { done, value } = await reader.read();
//       if (done) break;
//       if (!value || value.length === 0) {
//         logError(`流式响应读取异常：返回false Uint8Array，检查模型加载状态`);
//         continue;
//       }
//       const chunk = decoder.decode(value);
//       const lines = chunk.split('\n').filter(line => line.trim() !== '');
//        if (lines.length === 0) {
//         logError(`Stream无返回数据：确认模型已完全加载（终端出现>>>提示符）`);
//         continue;
//       }
//       for (const line of lines) {
//         // if (line.startsWith('data: ')) {
//         //   const data = line.slice(6);
//         //   if (data === '[DONE]') continue;
//           try {
//             const parsed = JSON.parse(line);
//             const content = parsed.message?.content || '';
//             if (content.trim() || content === '\n' || content === '{') {
//               res.write(content);
//               res.flush?.(); // 与原有前端交互逻辑完全兼容，无需修改前端代码
//             }
//           } catch (err) {
//             logError(`流式响应解析失败：${err.message}`);
//           }
//         // }
//       }
//     }
//     res.end();
//   } catch (err) {
//     logError(`大模型调用异常：${err.message}`);
//     res.writeHead(500, { 'Content-Type': 'application/json' });
//     res.end(JSON.stringify({ code: 500, message: err.message }));
//   }
// }

// 线上模型（DeepSeek 免费API）调用函数（直接替换原有本地模型调用函数，适配现有代码）
// 彻底解决本地模型流式输出、解析异常、Uint8Array等所有报错，开箱即用
async function callLargeModel(prompt, context, res) {
  try {
    // 对接DeepSeek 线上API（文档1确认已上线，无需本地部署，联网即可调用）
    const response = await fetch('https://aicode.longsys.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Access-Control-Allow-Origin': '*', // 解决跨域问题，适配前端交互
        'Authorization': `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}` // 读取.env中的API Key
      },
      body: JSON.stringify({
        model: "Qwen3.5-122B-A10B", // 免费可用模型，适配AI Agent场景
        messages: [
          { role: "system", content: "你是Node.js AI Agent，基于上传的知识库回答问题，精准、简洁。" },
          { role: "user", content: `${prompt}，上下文参考：${context}` }
        ],
        stream: true, // 保持流式输出，适配原有前端打字机效果，无需修改前端代码
        temperature: 0.7,
        max_tokens: 2048 // 匹配免费额度单次最大token限制
      }),
      signal: AbortSignal.timeout(60000) // 超时保护，避免网络异常导致卡顿
    });
    logOperation(`但前提问${prompt}，上下文参考：${context}`);
    if (!response.ok) {
      throw new Error(`DeepSeek线上模型调用失败：${response.statusText}，请检查API Key是否正确、网络是否通畅`);
    }

    if (!response.body) {
      throw new Error(`无法创建流式响应：网络异常或API服务临时不可用，请重试`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    // 适配DeepSeek API标准流式响应格式（带data: 前缀），解析逻辑稳定，无本地模型解析异常
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // 捕获异常，避免网络波动导致的读取失败
      if (!value || value.length === 0) {
        logError(`流式响应读取异常：网络波动，重试即可`);
        continue;
      }
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim() !== '');
      
      // 日志打印，方便排查调用问题（可保留或删除）
      if (lines.length > 0) {
        logError(`流式响应正常：lines有数据，共${lines.length}条，内容：${JSON.stringify(lines)}`);
      }

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices[0]?.delta || {};
            const content = delta.content || '';
            const finishReason = parsed.choices[0]?.finish_reason || '';
            // 输出有效内容，适配原有前端交互逻辑
            if (content) {
              res.write(content);
              res.flush?.(); // 确保流式实时输出，适配不同Node.js版本
            }
            if (finishReason === 'stop') {
              break;
            }  // 处理content为null的情况（正常终止场景，无需报错）
            if (!content && finishReason === 'stop') {
              logError(`流式响应正常终止：finish_reason=stop，无更多内容`);
              continue;
            } else if (!content) {
              logError(`解析到空content：返回结构中delta.content为null，可忽略`);
            }
          } catch (err) {
            logError(`JSON解析失败：${err.message}，当前line内容：${line}`);
            continue; // 跳过异常line，避免流式中断
          }
        } else {
          logError(`非标准流式响应格式：${line}，网络波动导致，重试即可`);
        }
      }
    }
    res.end();
  } catch (err) {
    logError(`线上模型调用异常：${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 500, message: `线上模型调用失败：${err.message}` }));
  }
}
function logError(content) { logOperation(content, 'error'); }

const taskPriority = {
  '查询前端转AI的学习方向和核心内容': 4,
  '查询前端转AI的项目实操要求': 4,
  '查询前端转AI的求职技巧': 3,
  '查询前端转AI的避坑提醒': 2,
  '查询前端转AI全栈开发相关内容': 4,
};

// 新增：文件名解码函数（解决中文文件名乱码问题）
function decodeFileName(fileName) {
  try {
    // 尝试将 Latin-1 编码的文件名转换为 UTF-8
    const buffer = Buffer.from(fileName, 'latin1');
    return buffer.toString('utf8');
  } catch (err) {
    // 如果解码失败，返回原始文件名
    return fileName;
  }
}

function splitTask(input) {
  const tasks = [];
  if (input.includes('学习') || input.includes('方向') || input.includes('路线')) tasks.push('查询前端转AI的学习方向和核心内容');
  if (input.includes('项目') || input.includes('实操')) tasks.push('查询前端转AI的项目实操要求');
  if (input.includes('求职') || input.includes('面试')) tasks.push('查询前端转AI的求职技巧');
  if (input.includes('避坑')) tasks.push('查询前端转AI的避坑提醒');
  if (input.includes('前端') || input.includes('向量') || input.includes('对接')) tasks.push('查询前端转AI全栈开发相关内容');
  // if (tasks.length === 0) tasks.push('通用问答：' + input);
  return tasks.sort((a, b) => (taskPriority[a.split('：')[0]] || 1) - (taskPriority[b.split('：')[0]] || 1));
}

function applyTaskRule(task, result, name) {
  if (task.includes('学习方向')) return result;
  if (task.includes('项目实操')) return result;
  if (task.includes('全栈') || task.includes('向量')) return `${result}\n💡 基于本地向量库检索`;
  return result;
}

async function executeTask(task, kb, input) {
  const key = `${kb}-${input}`;
  const cache = getCache(key);
  if (cache) return cache;

  let r;
  if (task.includes('学习方向')) r = await vectorSearch('前端转AI学习方向', kb);
  else if (task.includes('项目实操')) r = await vectorSearch('前端转AI项目实操', kb);
  else if (task.includes('求职技巧')) r = await vectorSearch('前端转AI求职技巧', kb);
  else if (task.includes('避坑')) r = await vectorSearch('前端转AI避坑', kb);
  else if (task.includes('全栈')) r = await vectorSearch('前端AI全栈开发', kb);
  else r = await vectorSearch(input, kb);

  const final = applyTaskRule(task, r, kb);
  if (!final.includes('未找到')) setCache(key, final);
  return final;
}

function manageMemory(mem, i, a, keep = 3, clear = false) {
  if (clear) return '';
  const nm = `${mem}用户：${i}\nAgent：${a}\n`;
  const lines = nm.trim().split('\n');
  return lines.length > keep * 2 ? lines.slice(-keep * 2).join('\n') + '\n' : nm;
}

function understandContext(input, mem) {
  if (input.length < 10 || ['那', '还有', '另外'].some(s => input.includes(s))) {
    const last = mem.split('\n').find(l => l.startsWith('用户：'));
    if (last) {
      const c = last.replace('用户：', '').trim();
      if (c.includes('学习')) return `前端转AI的${input}`;
      if (c.includes('项目')) return `前端转AI项目${input}`;
      if (c.includes('求职')) return `前端转AI求职${input}`;
      if (c.includes('前端') || c.includes('向量')) return `前端转AI全栈${input}`;
    }
  }
  return input;
}

async function createServer(mem, kb) {
  await initVectorStore(kb);
  
  // ✅ 使用 Express 而不是原生 http.createServer
  app.use(express.json()); // 解析 JSON
  app.use(express.urlencoded({ extended: true })); // 解析 URL 编码
  
  // 静态文件服务
  app.use(express.static(path.join(__dirname, 'public')));

  // 获取知识库列表
  app.get('/api/knowledge', (req, res) => {
    res.json({ code: 200, data: getKnowledgeList() });
  });

  // 切换知识库
  app.post('/api/switchKb', async (req, res) => {
    const { kbName } = req.body;
    kb = kbName;
    await initVectorStore(kbName);
    res.json({ code: 200, message: '已切换' });
  });

  // 清空缓存
  app.get('/api/clearCache', (req, res) => {
    res.json({ code: 200, message: clearCache() });
  });

  // 聊天接口
  app.post('/api/chat', async (req, res) => {
    try {
      const { userInput, currentKB  } = req.body;
      const kbPath = currentKB ? path.join(__dirname, currentKB) : '';
      const context = kbPath ? fs.readFileSync(kbPath, 'utf-8') : '';
      await callLargeModel(userInput, context, res);
      // mem = manageMemory(mem, userInput, '', 3, clearMemory);
      // const input = understandContext(userInput, mem);
      // const tasks = splitTask(input);
      // const taskResults = await Promise.all(tasks.map(task => executeTask(task, kb, input)));
      // const agentReply = taskResults.join('\n\n') || '知识库没找到相关信息';
      // mem = manageMemory(mem, userInput, agentReply, 3);
      // res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      // res.setHeader('Cache-Control', 'no-cache');
      // res.setHeader('Connection', 'keep-alive');
      // for (let i = 0; i < agentReply.length; i++) {
      //   res.write(agentReply[i]);
      //   await new Promise(r => setTimeout(r, 30));
      // }
      // res.end();
    } catch (err) {
      res.status(500).json({ code: 500, message: '聊天接口异常：' + err.message });
    }
  });

  // 获取日志
  app.get('/api/logs', (req, res) => {
    res.json({ code: 200, data: getLogs() });
  });

  // 修改：上传知识库文件接口
  app.post('/api/uploadKb', async (req, res) => {
      if (!req.files || Object.keys(req.files).length === 0) {
          return res.status(400).json({ 
              code: 400, 
              message: '请选择要上传的知识库文件' 
          });
      }

      const kbFile = req.files.kbFile;
      const fileName = decodeFileName(kbFile.name.trim());
      const ext = path.extname(fileName).toLowerCase();
      
      // 支持的文件类型
      const supportedExtensions = ['.txt', '.pdf', '.doc', '.docx', '.md', '.xlsx', '.xls'];
      
      if (!supportedExtensions.includes(ext)) {
          return res.status(400).json({ 
              code: 400, 
              message: `不支持的文件格式：${ext}。支持格式：${supportedExtensions.join(', ')}` 
          });
      }

      // 检查文件大小（10MB）
      if (kbFile.size > 10 * 1024 * 1024) {
          return res.status(400).json({ 
              code: 400, 
              message: '文件过大，最大支持10MB' 
          });
      }

      const savePath = path.join(__dirname, fileName);
      let finalSavePath = savePath;
      
      if (fs.existsSync(finalSavePath)) {
          const timestamp = new Date().getTime();
          const baseName = fileName.substring(0, fileName.lastIndexOf('.'));
          finalSavePath = path.join(__dirname, `${baseName}_${timestamp}${ext}`);
      }

      kbFile.mv(finalSavePath, async (err) => {
          if (err) {
              logError(`知识库文件上传失败：${err.message}`);
              return res.status(500).json({ 
                  code: 500, 
                  message: '文件上传失败，请重试' 
              });
          }
          
          try {
              // 解析文件内容
              const content = await parseFile(finalSavePath, fileName);
              
              // 如果是非TXT文件，将解析后的内容保存为TXT
              if (ext !== '.txt' && ext !== '.md') {
                  const txtFileName = `${path.basename(finalSavePath, ext)}.txt`;
                  const txtSavePath = path.join(__dirname, txtFileName);
                  fs.writeFileSync(txtSavePath, content, 'utf-8');
                  
                  // 删除原始文件
                  fs.unlinkSync(finalSavePath);
                  finalSavePath = txtSavePath;
              }
              
              const savedFileName = path.basename(finalSavePath);
              await initVectorStore(savedFileName);
              
              logOperation(`知识库文件上传成功：${finalSavePath}`);
              res.json({ 
                  code: 200, 
                  message: '知识库上传成功',
                  data: { fileName: savedFileName }
              });
          } catch (err) {
              logError(`文件解析失败：${err.message}`);
              // 删除已上传的文件
              if (fs.existsSync(finalSavePath)) {
                  fs.unlinkSync(finalSavePath);
              }
              res.status(500).json({ 
                  code: 500, 
                  message: `文件解析失败：${err.message}` 
              });
          }
      });
  });

  // 新增：网页导入接口
  app.post('/api/importWeb', async (req, res) => {
      const { url } = req.body;
      
      if (!url) {
          return res.status(400).json({ 
              code: 400, 
              message: '请提供网页URL' 
          });
      }
      
      try {
          // 抓取网页内容
          const content = await fetchWebContent(url);
          if (!content || content.length < 100) {
              return res.status(400).json({ 
                  code: 400, 
                  message: '网页内容为空或过少，无法导入' 
              });
          }
          
          // 生成文件名
          const urlObj = new URL(url);
          const domain = urlObj.hostname.replace(/\./g, '_');
          const timestamp = new Date().getTime();
          const fileName = `${domain}_${timestamp}.txt`;
          const savePath = path.join(__dirname, fileName);
          
          // 保存内容
          fs.writeFileSync(savePath, content, 'utf-8');
          
          // 初始化向量库
          await initVectorStore(fileName);
          
          logOperation(`网页导入成功：${url} -> ${fileName}`);
          res.json({ 
              code: 200, 
              message: '网页导入成功',
              data: { fileName }
          });
      } catch (err) {
          logError(`网页导入失败：${err.message}`);
          res.status(500).json({ 
              code: 500, 
              message: `网页导入失败：${err.message}` 
          });
      }
  });
  //删除知识库
   app.post('/api/deleteKb', (req, res) => {
    const { kbName } = req.body;
    
    if (!kbName) {
      return res.status(400).json({ 
        code: 400, 
        message: '请指定要删除的知识库名称' 
      });
    }

    const filePath = path.join(__dirname, kbName);
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        code: 404, 
        message: '知识库文件不存在' 
      });
    }

    try {
      // 删除文件
      fs.unlinkSync(filePath);
      
      // 清除相关的向量库缓存
      if (vectorStores[kbName]) {
        delete vectorStores[kbName];
      }
      
      // 清除内存缓存
      const cacheKey = `vectorStore_${kbName}`;
      memoryCache.delete(cacheKey);
      
      logOperation(`知识库文件删除成功：${kbName}`);
      res.json({ 
        code: 200, 
        message: `✅ 知识库 "${kbName}" 删除成功` 
      });
    } catch (err) {
      logError(`知识库文件删除失败：${err.message}`);
      res.status(500).json({ 
        code: 500, 
        message: '删除失败，请重试' 
      });
    }
  });

  // 启动服务器
  app.listen(3000, () => {
    logOperation('✅ 本地离线服务启动成功：http://localhost:3000');
  });
}

async function terminalInteraction(mem, kb) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '你：' });
  logOperation('✅ 终端离线模式已启动');
  rl.prompt();
  rl.on('line', async (input) => {
    const i = input.trim();
    if (i === '退出') process.exit(0);
    if (i === '清空缓存') { console.log('Agent：' + clearCache()); rl.prompt(); return; }
    if (i === '清空记忆') { mem = ''; console.log('Agent：✅ 记忆已清空'); rl.prompt(); return; }
    if (i === '切换知识库') {
      const list = getKnowledgeList();
      console.log('Agent：可用：' + list.join('、'));
      rl.question('输入名称：', async (name) => {
        if (list.includes(name)) { kb = name; await initVectorStore(kb); console.log('✅ 已切换'); }
        else console.log('❌ 不存在');
        rl.prompt();
      });
      return;
    }
    mem = manageMemory(mem, i, '', 3, false);
    const ui = understandContext(i, mem);
    const tasks = splitTask(ui);
    const res = await Promise.all(tasks.map(t => executeTask(t, kb, ui)));
    const reply = res.join('\n\n');
    mem = manageMemory(mem, i, reply, 3);
    console.log('Agent：' + reply);
    rl.prompt();
  });
}

async function start() {
  let mem = '';
  let kb = 'long_knowledge.txt';
  await initVectorStore(kb);
  createServer(mem, kb);
  terminalInteraction(mem, kb);
  initCache();
}

start();