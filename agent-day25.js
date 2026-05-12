// Day25 Node.js AI Agent 企业级优化版
// 核心功能：任务优先级排序 + 自定义规则配置 + 操作日志记录 + 上下文记忆优化
// 离线运行、零依赖、纯Node.js原生API、贴合前端转AI企业级落地场景
// 衔接Day24 Agent，复用知识库、上下文理解、任务拆分核心逻辑

const fs = require('fs');
const readline = require('readline');
const path = require('path');

// 1. 复用知识库（和Day23、Day24一致，无需修改）
function loadKnowledge() {
  try {
    return fs.readFileSync('long_knowledge.txt', 'utf8').trim();
  } catch (err) {
    logError('未找到long_knowledge.txt，请确保文件在同目录');
    process.exit(1);
  }
}

// 2. 新增：操作日志记录（企业级必备，便于调试、复盘）
function logOperation(content, type = 'info') {
  // 日志文件路径（同目录下agent_logs.txt，自动创建）
  const logPath = path.join(__dirname, 'agent_logs.txt');
  // 日志格式：时间 + 类型 + 内容
  const logContent = `[${new Date().toLocaleString()}] [${type.toUpperCase()}] ${content}\n`;
  
  try {
    // 追加写入日志，不会覆盖历史记录
    fs.appendFileSync(logPath, logContent);
    // 终端同步打印日志（便于实时查看）
    if (type === 'error') {
      console.log(`❌ ${logContent.trim()}`);
    } else {
      console.log(`📝 ${logContent.trim()}`);
    }
  } catch (err) {
    console.log('❌ 日志写入失败：', err.message);
  }
}

// 简化错误日志记录
function logError(content) {
  logOperation(content, 'error');
}

// 3. 新增：任务优先级配置（企业级核心，自主判断任务优先级）
// 优先级从高到低：核心需求（学习/项目）→ 求职 → 避坑 → 通用问答
const taskPriority = {
  '查询前端转AI的学习方向和核心内容': 4, // 最高优先级
  '查询前端转AI的项目实操要求': 4,
  '查询前端转AI的求职技巧': 3,
  '查询前端转AI的避坑提醒': 2,
  '通用问答': 1 // 最低优先级
};

// 3. Agent 核心1：任务拆分（复用Day24逻辑，新增优先级排序）
function splitTask(userInput) {
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

  // 新增：按优先级排序（从高到低执行，核心需求先完成）
  tasks.sort((a, b) => {
    // 匹配优先级，未匹配到的按最低优先级处理
    const priorityA = taskPriority[a.split('：')[0]] || 1;
    const priorityB = taskPriority[b.split('：')[0]] || 1;
    return priorityB - priorityA;
  });

  return tasks;
}

// 4. 新增：自定义任务规则（可灵活配置，适配不同场景）
// 规则1：学习类任务，优先提取核心关键词（如“Python工程化、RAG”）
// 规则2：项目类任务，补充项目数量和核心要求
function applyTaskRule(task, result) {
  // 规则1：学习类任务优化
  if (task.includes('学习方向')) {
    // 提取核心关键词，让回答更简洁（企业级交互要求：精准、高效）
    const keywords = result.match(/Python工程化|RAG知识库开发|AI流式对话|Agent智能体编排/g);
    if (keywords) {
      return `${result}\n💡 核心关键词：${keywords.join('、')}`;
    }
  }

  // 规则2：项目类任务优化
  if (task.includes('项目实操')) {
    // 补充项目落地提示，贴合前端转AI求职需求
    return `${result}\n💡 项目提示：这两个项目是前端转AI求职的核心加分项，建议优先完成RAG机器人开发`;
  }

  // 其他任务沿用原结果
  return result;
}

// 5. Agent 核心2：任务执行（复用Day24逻辑，新增规则应用）
function executeTask(task, knowledge) {
  const lines = knowledge.split('\n').filter(line => line.trim());
  
  // 根据任务匹配知识库内容，精准提取
  let result = '';
  if (task.includes('学习方向')) {
    result = lines.find(line => line.includes('学习方向')) || '未找到学习方向相关内容';
  } else if (task.includes('项目实操')) {
    result = lines.find(line => line.includes('项目实操')) || '未找到项目实操相关内容';
  } else if (task.includes('求职技巧')) {
    result = lines.find(line => line.includes('求职技巧')) || '未找到求职技巧相关内容';
  } else if (task.includes('避坑提醒')) {
    result = lines.find(line => line.includes('避坑')) || '未找到避坑相关内容';
  } else {
    // 通用问答：语义匹配（复用Day23、Day24逻辑）
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
    result = bestMatch || '未找到相关内容';
  }

  // 新增：应用自定义任务规则，优化回答结果
  return applyTaskRule(task, result);
}

// 6. Agent 核心3：多轮上下文记忆（优化Day24逻辑，新增记忆清空接口）
function manageMemory(memory, userInput, agentReply, keepRound = 3, clear = false) {
  // 新增：清空记忆（配合菜单功能，企业级可维护性）
  if (clear) {
    logOperation('聊天记忆已手动清空');
    return '';
  }

  // 存储本轮问答
  const newMemory = `${memory}用户：${userInput}\nAgent：${agentReply}\n`;
  // 裁剪记忆，只保留最近3轮，避免内存溢出、上下文冗余
  const rounds = newMemory.trim().split('\n');
  if (rounds.length > keepRound * 2) {
    const trimmedMemory = rounds.slice(-keepRound * 2).join('\n') + '\n';
    logOperation(`记忆自动裁剪，保留最近${keepRound}轮对话`);
    return trimmedMemory;
  }
  return newMemory;
}

// 7. Agent 核心4：上下文理解（复用Day24逻辑，优化简写识别）
function understandContext(userInput, memory) {
  // 优化：增加更多简写衔接词，提升识别准确率
  if (userInput.includes('那') || userInput.includes('也') || userInput.includes('还有') || 
      userInput.includes('另外') || userInput.includes('补充') || userInput.length < 10) {
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
      if (core需求.includes('避坑')) {
        return `前端转AI的避坑相关${userInput}`;
      }
    }
  }
  // 正常提问，直接返回
  return userInput;
}

// 8. 新增：交互式菜单（企业级操作体验，支持多功能切换）
function showMenu() {
  console.log('\n=======================================');
  console.log('    Day25 Node.js AI Agent 企业级版');
  console.log('=======================================');
  console.log('📌 功能菜单：');
  console.log('   1. 进入问答模式（支持复杂任务、简写追问）');
  console.log('   2. 手动清空聊天记忆');
  console.log('   3. 查看操作日志');
  console.log('   4. 退出程序');
  console.log('=======================================\n');
}

// 9. Agent 主入口（整合所有优化功能，新增菜单交互）
async function startAgent() {
  const knowledge = loadKnowledge();
  let memory = ''; // 初始化多轮记忆

  // 终端交互（优化Day24风格，新增菜单）
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  logOperation('Agent 程序启动成功，进入主菜单');
  showMenu();

  // 主菜单循环
  while (true) {
    const opt = await new Promise(resolve => rl.question('请选择功能编号(1-4)：', resolve));

    switch (opt.trim()) {
      case '1':
        // 问答模式（复用Day24逻辑，新增日志记录）
        console.log('\n💡 进入问答模式，输入“返回”回到菜单');
        logOperation('进入问答模式');
        while (true) {
          const userInput = await new Promise(resolve => rl.question('🙋 你：', resolve));
          // 返回菜单
          if (userInput.trim() === '返回') {
            logOperation('退出问答模式，返回主菜单');
            showMenu();
            break;
          }

          try {
            // 1. 上下文理解：补全简写提问
            const fullInput = understandContext(userInput, memory);
            // 2. 任务拆分：思考并拆分复杂需求（带优先级排序）
            const tasks = splitTask(fullInput);
            console.log(`\n🤖 Agent 思考：已拆分任务（共${tasks.length}个，按优先级排序）`);
            tasks.forEach((task, index) => console.log(`   ${index + 1}. ${task}`));
            logOperation(`拆分任务：${tasks.join(' | ')}`);

            // 3. 执行任务：逐个执行，整合结果（带规则应用）
            console.log('\n🤖 Agent 正在执行任务...\n');
            logOperation('开始执行拆分任务');
            const results = tasks.map(task => executeTask(task, knowledge));

            // 4. 整合回答，生成最终回复
            let agentReply = '✅ 任务执行完成，结果如下：\n';
            results.forEach((result, index) => {
              agentReply += `\n${index + 1}. ${result}`;
            });

            // 5. 更新记忆：存储本轮问答，自动裁剪
            memory = manageMemory(memory, userInput, agentReply);

            // 6. 输出结果 + 记录日志
            console.log(agentReply + '\n');
            logOperation(`用户提问：${userInput} | 回答成功`);
          } catch (err) {
            const errorMsg = `Agent 执行异常：${err.message}`;
            console.log(`\n❌ ${errorMsg}\n`);
            logError(errorMsg);
          }
        }
        break;

      case '2':
        // 手动清空记忆
        memory = manageMemory(memory, '', '', 3, true);
        console.log('\n✅ 聊天记忆已手动清空！\n');
        showMenu();
        break;

      case '3':
        // 查看操作日志
        try {
          const logPath = path.join(__dirname, 'agent_logs.txt');
          if (fs.existsSync(logPath)) {
            const logs = fs.readFileSync(logPath, 'utf8');
            console.log('\n📋 操作日志：\n', logs || '暂无日志记录');
          } else {
            console.log('\n📋 暂无操作日志（执行问答后会自动生成）\n');
          }
        } catch (err) {
          logError(`查看日志失败：${err.message}`);
        }
        showMenu();
        break;

      case '4':
        // 退出程序
        logOperation('Agent 程序正常退出');
        console.log('\n👋 Agent 程序已安全退出，操作日志已保存至 agent_logs.txt\n');
        rl.close();
        process.exit(0);
        break;

      default:
        console.log('\n❌ 输入无效，请选择1-4之间的功能编号！\n');
        showMenu();
        break;
    }
  }
}

// 启动Agent
startAgent();
