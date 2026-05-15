// Day24 Node.js AI Agent 智能体进阶
// 核心功能：复杂任务拆分 + 多轮上下文记忆 + 自动执行 + 结果整合
// 离线运行、零依赖、纯Node.js原生API、贴合前端转AI场景
// 衔接Day23 RAG知识库，可直接复用long_knowledge.txt

const fs = require('fs');
const readline = require('readline');

// 1. 复用知识库（和Day23 RAG一致，无需修改）
function loadKnowledge() {
  try {
    return fs.readFileSync('long_knowledge.txt', 'utf8').trim();
  } catch (err) {
    console.log('❌ 未找到long_knowledge.txt，请确保文件在同目录');
    process.exit(1);
  }
}

// 2. Agent 核心1：任务拆分（思考能力升级，能拆复杂需求）
function splitTask(userInput) {
  // 复杂需求自动拆分，比如“整理学习路线和项目要求”→拆成2个任务
  const tasks = [];

  // 匹配学习路线相关需求
  if (userInput.includes('学习') || userInput.includes('路线') || userInput.includes('方向')) {
    tasks.push('查询前端转AI的学习方向和核心内容');
  }

  // 匹配项目相关需求
  if (userInput.includes('项目') || userInput.includes('实战') || userInput.includes('实操')) {
    tasks.push('查询前端转AI的项目实操要求');
  }

  // 匹配求职相关需求
  if (userInput.includes('求职') || userInput.includes('简历') || userInput.includes('面试')) {
    tasks.push('查询前端转AI的求职技巧');
  }

  // 匹配避坑相关需求
  if (userInput.includes('避坑') || userInput.includes('不要学') || userInput.includes('提醒')) {
    tasks.push('查询前端转AI的避坑提醒');
  }

  // 兜底：无明确拆分项，按通用问答处理
  if (tasks.length === 0) {
    tasks.push('通用问答：' + userInput);
  }

  return tasks;
}

// 3. Agent 核心2：任务执行（对接知识库，完成拆分后的任务）
function executeTask(task, knowledge) {
  const lines = knowledge.split('\n').filter(line => line.trim());
  
  // 根据任务匹配知识库内容，精准提取
  if (task.includes('学习方向')) {
    return lines.find(line => line.includes('学习方向')) || '未找到学习方向相关内容';
  }
  if (task.includes('项目实操')) {
    return lines.find(line => line.includes('项目实操')) || '未找到项目实操相关内容';
  }
  if (task.includes('求职技巧')) {
    return lines.find(line => line.includes('求职技巧')) || '未找到求职技巧相关内容';
  }
  if (task.includes('避坑提醒')) {
    return lines.find(line => line.includes('避坑')) || '未找到避坑相关内容';
  }

  // 通用问答：语义匹配（复用Day23 RAG的语义检索逻辑）
  const semanticMap = {
    实战: ['项目', '实操', '练习'],
    项目: ['实战', '实操'],
    RAG: ['知识库', '检索', '拆分'],
    算法: ['数学', '机器学习'],
    学习: ['方向', '掌握']
  };

  const keys = new Set();
  for (const [intent, words] of Object.entries(semanticMap)) {
    for (const w of words) {
      if (task.includes(w)) {
        words.forEach(k => keys.add(k));
        keys.add(intent);
      }
    }
  }

  let bestMatch = '';
  let maxCount = 0;
  for (const line of lines) {
    let count = 0;
    keys.forEach(key => line.includes(key) && count++);
    if (count > maxCount) {
      maxCount = count;
      bestMatch = line;
    }
  }

  return bestMatch || '未找到相关内容';
}

// 4. Agent 核心3：多轮上下文记忆（衔接Day23，优化记忆裁剪）
function manageMemory(memory, userInput, agentReply, keepRound = 3) {
  // 存储本轮问答
  const newMemory = `${memory}用户：${userInput}\nAgent：${agentReply}\n`;
  // 裁剪记忆，只保留最近3轮，避免内存溢出、上下文冗余
  const rounds = newMemory.trim().split('\n');
  if (rounds.length > keepRound * 2) {
    return rounds.slice(-keepRound * 2).join('\n') + '\n';
  }
  return newMemory;
}

// 5. Agent 核心4：上下文理解（能接上文，简写追问也能识别）
function understandContext(userInput, memory) {
  // 若用户提问简短，结合记忆补全语境
  if (userInput.includes('那') || userInput.includes('也') || userInput.includes('还有') || userInput.length < 10) {
    const lastUserInput = memory.split('\n').find(line => line.startsWith('用户：'));
    if (lastUserInput) {
      // 提取上一轮用户核心需求，补全当前简写提问
      const core需求 = lastUserInput.replace('用户：', '').trim();
      if (core需求.includes('学习')) {
        return `前端转AI的${userInput}`;
      }
      if (core需求.includes('项目')) {
        return `前端转AI的项目相关${userInput}`;
      }
      if (core需求.includes('求职')) {
        return `前端转AI的求职相关${userInput}`;
      }
    }
  }
  // 正常提问，直接返回
  return userInput;
}

// 6. Agent 主入口（整合：思考→拆任务→执行→记忆→上下文）
async function startAgent() {
  const knowledge = loadKnowledge();
  let memory = ''; // 初始化多轮记忆

  // 终端交互（沿用Day23风格，保持一致性）
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('=======================================');
  console.log('    Day24 Node.js AI Agent 进阶版');
  console.log('=======================================');
  console.log('✅ 功能：复杂任务拆分、多轮记忆、上下文理解');
  console.log('✅ 场景：前端转AI相关问答（学习、项目、求职、避坑）');
  console.log('✅ 提示：可简写追问（如先问“学习路线”，再问“还有项目？”）');
  console.log('✅ 输入“退出”结束程序\n');

  // 多轮对话循环
  while (true) {
    const userInput = await new Promise(resolve => rl.question('🙋 你：', resolve));

    // 退出逻辑
    if (userInput.trim() === '退出') {
      console.log('\n👋 Agent 对话结束，已保存最近3轮聊天记忆');
      rl.close();
      break;
    }

    try {
      // 1. 上下文理解：补全简写提问
      const fullInput = understandContext(userInput, memory);
      // 2. 任务拆分：思考并拆分复杂需求
      const tasks = splitTask(fullInput);
      console.log(`\n🤖 Agent 思考：已拆分任务（共${tasks.length}个）`);
      tasks.forEach((task, index) => console.log(`   ${index + 1}. ${task}`));

      // 3. 执行任务：逐个执行，整合结果
      console.log('\n🤖 Agent 正在执行任务...\n');
      const results = tasks.map(task => executeTask(task, knowledge));

      // 4. 整合回答，生成最终回复
      let agentReply = '✅ 任务执行完成，结果如下：\n';
      results.forEach((result, index) => {
        agentReply += `\n${index + 1}. ${result}`;
      });

      // 5. 更新记忆：存储本轮问答，自动裁剪
      memory = manageMemory(memory, userInput, agentReply);

      // 6. 输出结果
      console.log(agentReply + '\n');
    } catch (err) {
      console.log('\n❌ Agent 执行异常：', err.message + '\n');
    }
  }
}

// 启动Agent
startAgent();
