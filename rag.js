const fs = require('fs')
const readline = require('readline')

// 1. 读取长文档
function loadLongKnowledge() {
  return fs.readFileSync('long_knowledge.txt', 'utf8')
}

// 2. 文档拆分（和Python版逻辑一样）
function splitLongDoc(text, splitLength = 2) {
  const sentences = text.split('\n').filter(s => s.trim())
  const fragments = []
  for (let i = 0; i < sentences.length; i += splitLength) {
    fragments.push(sentences.slice(i, i + splitLength).join('\n'))
  }
  return fragments
}

// 3. 智能语义检索（实战→项目，求职→简历）
function smartSearch(question, fragments) {
  const map = {
    实战: ['项目', '实操', '练习', '动手'],
    项目: ['实战', '实操'],
    求职: ['找工作', '简历', '面试'],
    RAG: ['知识库', '检索', '拆分'],
    算法: ['数学', '机器学习'],
    学习: ['方向', '掌握'],
  }

  const keys = new Set()
  for (const [intent, words] of Object.entries(map)) {
    for (const w of words) {
      if (question.includes(w)) {
        words.forEach(k => keys.add(k))
        keys.add(intent)
      }
    }
  }

  let best = ''
  let max = 0
  for (const frag of fragments) {
    let count = 0
    keys.forEach(k => frag.includes(k) && count++)
    if (count > max) {
      max = count
      best = frag
    }
  }
  return best || '未找到内容'
}

// 4. 主对话逻辑
async function startChat() {
  const text = loadLongKnowledge()
  const fragments = splitLongDoc(text)
  let memory = ''

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log('✅ Node.js RAG 离线智能问答已启动')
  console.log('输入 退出 结束\n')

  while (true) {
    const question = await new Promise(resolve => rl.question('🙋 你：', resolve))

    if (question === '退出') {
      console.log('👋 结束')
      rl.close()
      break
    }

    const relevant = smartSearch(question, fragments)
    const answer = `🤖 AI：根据知识库回答：\n${relevant}`
    
    console.log(answer + '\n')
    memory += `用户：${question}\nAI：${answer}\n`
  }
}

startChat()