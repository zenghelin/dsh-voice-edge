// 离线小模型合成（跑在**子进程**里）
//
// 为什么单独一个进程：sherpa-onnx 是原生模块，模型/config 不对时会直接段错误崩掉进程。
// 放在子进程里，崩了只有这一条合成失败，DSH 宿主不受影响。
//
// 用法：node lib/offline-tts.mjs <模型目录> <出文件.wav> <文字>
import fs from 'node:fs'
import path from 'node:path'

const [模型目录, 出文件, 文字] = process.argv.slice(2)
if (!模型目录 || !出文件 || !文字) {
  console.error('用法：node offline-tts.mjs <模型目录> <出文件.wav> <文字>')
  process.exit(2)
}

const 文件们 = fs.readdirSync(模型目录)
const onnx = 文件们.find((f) => f.endsWith('.onnx'))
if (!onnx) { console.error('模型目录里没有 .onnx：' + 模型目录); process.exit(3) }

let sherpa = null
try {
  sherpa = (await import('sherpa-onnx-node')).default
} catch (error) {
  console.error('sherpa-onnx-node 没装上：' + String((error && error.message) || error))
  process.exit(4)
}

const 有 = (名) => (文件们.includes(名) ? path.join(模型目录, 名) : '')
const 配置 = {
  model: {
    vits: {
      model: path.join(模型目录, onnx),
      ...(有('tokens.txt') ? { tokens: 有('tokens.txt') } : {}),
      ...(有('lexicon.txt') ? { lexicon: 有('lexicon.txt') } : {}),
    },
    numThreads: 2,
    provider: 'cpu',
    debug: false,
  },
  maxNumSentences: 1,
}

const tts = new sherpa.OfflineTts(配置)
const 音频 = tts.generate({ text: 文字, sid: 0, speed: 1.0 })
if (!音频 || !音频.samples || !音频.samples.length) { console.error('没合成出东西'); process.exit(5) }

fs.mkdirSync(path.dirname(出文件), { recursive: true })
sherpa.writeWave(出文件, { samples: 音频.samples, sampleRate: 音频.sampleRate })
console.log(JSON.stringify({ ok: true, 文件: 出文件, 采样率: 音频.sampleRate, 样本: 音频.samples.length }))