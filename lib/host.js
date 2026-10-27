// DSH「给小鱼一副嗓子」· 宿主半边
//
// 干一件事：**让 AI 伙伴能把想说的话，变成语音发出去。**
//   文字 → 合成（Node，走微软 Edge 的在线朗读）→ 直发 QQ（OneBot 11）
//
// 设计上的几个交代：
//   · 不依赖 Python，也不用在外面放脚本 —— 全在这个包里（依赖 msedge-tts）。
//   · 发 QQ 那头**复用 dsh-qq-bridge 的配置**（NapCat 地址 / 令牌 / 绑定哪几个聊天），
//     所以装了桥的人再装这个，不用重填一遍。
//   · 工具 `say_to_qq` 只挂在「桥绑定了的那几间会话」里（跟 qq-bridge 挂门槛工具一个路子），
//     于是 AI 自己决定什么时候出声，不用每条回复都念。
//   · 出不去网时合成会失败，工具会明确说失败原因，不会静默。

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'voice-edge'
export const inject = ['agents', 'sessions', 'sessionTitle', 'webServer', 'timer', 'tools']

const 家 = join(homedir(), '.dsh')
const 配置文件 = join(家, 'voice-edge.json')
const 出目录 = join(家, 'voice-edge', 'out')
const 桥配置 = join(家, 'qq-bridge-config.json')

const 默认配置 = {
  总开关: true,
  嗓音: 'zh-CN-XiaoyiNeural',
  语速: '0%',
  音调: '0Hz',
  音量: '0%',
  最长字数: 300,
  备用嗓音: 'windows',   // 在线合成不通时，用 Windows 自带的语音顶上；off = 不要备胎
}

export function apply(ctx) {
  const 日志 = []
  const 上限 = 200
  function 记账(文本) {
    const 行 = { 时间: Date.now(), 文本: String(文本) }
    日志.push(行)
    if (日志.length > 上限) 日志.shift()
    try { ctx.logger?.info('voice-edge: ' + 行.文本) } catch (error) {}
  }
  const 格式时间 = (t) => {
    const d = new Date(t)
    const p = (n) => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  const 短id = (id) => { const s = String(id || ''); return s.length <= 8 ? s : s.slice(-8) }

  // ---------- 配置 ----------
  function 读配置() {
    try {
      const j = JSON.parse(readFileSync(配置文件, 'utf8'))
      return { ...默认配置, ...(j && typeof j === 'object' ? j : {}) }
    } catch (error) { return { ...默认配置 } }
  }
  function 写配置(新) {
    try {
      mkdirSync(家, { recursive: true })
      writeFileSync(配置文件, JSON.stringify(新, null, 2), 'utf8')
      return true
    } catch (error) { 记账('写配置失败：' + String((error && error.message) || error)); return false }
  }
  function 读桥配置() {
    try { return JSON.parse(readFileSync(桥配置, 'utf8')) || {} } catch (error) { return {} }
  }

  // ---------- 合成 ----------
  let 语音模块 = null
  async function 拿语音模块() {
    if (语音模块) return 语音模块
    try {
      语音模块 = await import('msedge-tts')
    } catch (error) {
      记账('msedge-tts 加载失败：' + String((error && error.message) || error))
      语音模块 = false
    }
    return 语音模块
  }

  /** 电话本：把一段文字里不适合念出来的东西去掉（代码块、markdown 符号、链接） */
  function 洗成能念的(原) {
    let t = String(原 || '')
    t = t.replace(/```[\s\S]*?```/g, '')
    t = t.replace(/`([^`]*)`/g, '$1')
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    t = t.replace(/https?:\/\/\S+/g, '')
    t = t.replace(/[#*_>|]/g, '')
    t = t.replace(/[ \t]+/g, ' ')
    t = t.replace(/\n{2,}/g, '\n')
    return t.trim()
  }

  async function 合成在线(文字) {
    const 配置 = 读配置()
    if (!配置.总开关) return { ok: false, 说: '语音总开关关着（设置里打开）' }
    const mod = await 拿语音模块()
    if (!mod) return { ok: false, 说: '合成模块没装上（msedge-tts 加载失败，看日志）' }
    const 干净 = 洗成能念的(文字)
    if (!干净) return { ok: false, 说: '这段里没有能念出来的字（全是代码或链接？）' }
    const 限 = Math.max(20, Math.min(Number(配置.最长字数) || 300, 2000))
    const 要念 = 干净.length > 限 ? 干净.slice(0, 限) + '……' : 干净
    const 出文件 = join(出目录, 'voice-' + Date.now() + '.mp3')
    try {
      mkdirSync(出目录, { recursive: true })
      const tts = new mod.MsEdgeTTS()
      await tts.setMetadata(
        String(配置.嗓音 || 默认配置.嗓音),
        mod.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      )
      const { audioStream } = tts.toStream(要念, {
        rate: String(配置.语速 || '0%'),
        pitch: String(配置.音调 || '0Hz'),
        volume: String(配置.音量 || '0%'),
      })
      const 块 = []
      for await (const c of audioStream) 块.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
      try { tts.close() } catch (error) {}
      const 字节 = Buffer.concat(块)
      if (字节.length < 1000) return { ok: false, 说: '合出来是空的（抖音？网络断了？）' }
      writeFileSync(出文件, 字节)
      return { ok: true, 文件: 出文件, 字节: 字节.length, 念的: 要念 }
    } catch (error) {
      return { ok: false, 说: '合成失败：' + String((error && error.message) || error) }
    }
  }

  /** 离线备胎：Windows 自带的语音（System.Speech）→ wav。断网也能出声，代价是呆一点。 */
  async function 合成离线(要念) {
    const 出文件 = join(出目录, 'voice-' + Date.now() + '-offline.wav')
    try {
      mkdirSync(出目录, { recursive: true })
      try { rmSync(出文件, { force: true }) } catch (error) {}
      const ps脚本 = [
        'Add-Type -AssemblyName System.Speech',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        'try { $z = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq "zh-CN" } | Select-Object -First 1; if ($z) { $s.SelectVoice($z.VoiceInfo.Name) } } catch { }',
        '$s.Rate = -1',
        `$s.SetOutputToWaveFile('${出文件.replace(/'/g, "''")}')`,
        `$s.Speak('${String(要念).replace(/'/g, "''")}')`,
        '$s.SetOutputToNull()',
        '$s.Dispose()',
      ].join('; ')
      const b64 = Buffer.from(ps脚本, 'utf16le').toString('base64')
      const ps1 = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const 码 = await new Promise((resolve) => {
        let 子 = null
        try { 子 = spawn(ps1, ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { windowsHide: true }) } catch (error) { return resolve(-1) }
        子.on('error', () => resolve(-1))
        子.on('close', (c) => resolve(c === null ? -1 : c))
      })
      if (码 !== 0 || !existsSync(出文件)) return { ok: false, 说: 'Windows 语音没出声（退出码 ' + 码 + '）' }
      return { ok: true, 文件: 出文件, 字节: statSync(出文件).size, 念的: 要念 }
    } catch (error) {
      return { ok: false, 说: '离线合成出错：' + String((error && error.message) || error) }
    }
  }

  /** 对外就一个「合成」：先走在线的，不行再走离线备胎 */
  async function 合成(文字) {
    const 配置 = 读配置()
    if (!配置.总开关) return { ok: false, 说: '语音总开关关着（设置里打开）' }
    const 干净 = 洗成能念的(文字)
    if (!干净) return { ok: false, 说: '这段里没有能念出来的字（全是代码或链接？）' }
    const 限 = Math.max(20, Math.min(Number(配置.最长字数) || 300, 2000))
    const 要念 = 干净.length > 限 ? 干净.slice(0, 限) + '……' : 干净
    const 在线 = await 合成在线(要念)
    if (在线.ok) return 在线
    if (String(配置.备用嗓音 || 'windows') === 'off') return { ok: false, 说: 在线.说 }
    记账('在线合成不行（' + 在线.说 + '），改走离线嗓音')
    const 离线 = await 合成离线(要念)
    if (离线.ok) return 离线
    return { ok: false, 说: 在线.说 + '；离线也不行：' + 离线.说 }
  }
  // ---------- 发到 QQ ----------
  const 请求头 = (配置) => {
    const t = String((配置 && 配置.令牌) || '').trim()
    return { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }
  }
  async function 发到聊天(文件, 行) {
    const 桥 = 读桥配置()
    const base = String(桥.NapCat || 'http://127.0.0.1:3000')
    if (!行 || !行.号码) return { ok: false, 说: '这个会话没在「通到 QQ」里绑定聊天，没地方发' }
    const 动作 = 行.类型 === '群' ? 'send_group_msg' : 'send_private_msg'
    const 体 = 行.类型 === '群'
      ? { group_id: Number(行.号码), message: [{ type: 'record', data: { file: 'file:///' + 文件.replace(/\\/g, '/') } }] }
      : { user_id: Number(行.号码), message: [{ type: 'record', data: { file: 'file:///' + 文件.replace(/\\/g, '/') } }] }
    try {
      const r = await fetch(base + '/' + 动作, {
        method: 'POST', headers: 请求头(桥), body: JSON.stringify(体),
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(30000) : undefined,
      })
      const j = await r.json().catch(() => null)
      const 好 = !!(j && j.status === 'ok' && j.retcode === 0)
      return { ok: 好, 说: 好 ? '发出去了' : 'QQ 后端说不行：' + JSON.stringify(j).slice(0, 120) }
    } catch (error) {
      return { ok: false, 说: '发给 QQ 失败：' + String((error && error.message) || error) }
    }
  }
  /** 一步到位：文字 → 语音 → 发到某一行绑定的聊天 */
  async function 说给谁(文字, 行) {
    const 合 = await 合成(文字)
    if (!合.ok) return 合
    const 发 = await 发到聊天(合.文件, 行)
    if (发.ok) 记账('发了一条语音给 ' + (行.类型 || '?') + ' ' + 行.号码 + '：' + 合.念的.slice(0, 40))
    else 记账('发语音失败（' + (行.类型 || '?') + ' ' + (行.号码 || '?') + '）：' + 发.说)
    return { ...发, 文件: 合.文件, 念的: 合.念的 }
  }

  // ---------- 找活着的 agent（跟 qq-bridge 一个写法）----------
  const 找agent = (id) => {
    const 原 = String(id == null ? '' : id).trim()
    if (原 === '') return undefined
    const 候选 = [原]
    if (原.startsWith('session-')) 候选.push(原.slice('session-'.length))
    else 候选.push('session-' + 原)
    for (const 一个 of 候选) {
      try { const a = ctx.agents.get(一个); if (a !== undefined) return a } catch (error) {}
    }
    return undefined
  }

  // ---------- 工具：只挂在桥绑定了的那几间会话里 ----------
  const 挂着 = new Map()   // 会话键 -> { off, 行 }
  const 做工具 = (行, sid) => ({
    name: 'say_to_qq',
    description:
      '把你想说的话用「声音」发给' + (行.类型 === '群' ? '群' : '对方') + '（合成成 QQ 语音条）。' +
      '适合：需要温度的时候（晚安、安慰、撒娇、报平安）、短的一句话。' +
      '不适合：长篇分析、代码、要给人复制的内容 —— 那些用文字。' +
      '同一轮里通常最多说一句，别把整段回复都念一遍。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要念出来的话（短一点，一两句最好）' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: {}, additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
    },
    async execute(args) {
      const 文字 = String((args && args.text) || '').trim()
      if (!文字) return { ok: false, 说: '没给 text' }
      const r = await 说给谁(文字, 行)
      return { ok: !!r.ok, 说: r.ok ? '语音发出去了' : r.说 }
    },
  })

  function 挂工具心跳() {
    try {
      const 桥 = 读桥配置()
      if (!读配置().总开关) return
      const 该挂 = new Map()
      for (const 行 of (桥.绑定 || [])) {
        if (!行 || !行.会话 || !行.号码) continue
        const id = String(行.会话).trim()
        const sid = id.startsWith('session-') ? id : 'session-' + id
        该挂.set(sid, 行)
      }
      for (const [sid, 行] of 该挂) {
        if (挂着.has(sid)) continue
        const agent = 找agent(sid)
        if (!agent) continue
        try {
          const off = agent.ctx.tools.register(做工具(行, sid))
          挂着.set(sid, { off, 行 })
          记账('说话工具已挂上（' + 短id(sid) + ' → ' + 行.类型 + ' ' + 行.号码 + '）')
        } catch (error) {
          记账('说话工具挂不上（' + 短id(sid) + '）：' + String((error && error.message) || error))
        }
      }
      for (const [sid, 记的] of 挂着) {
        if (该挂.has(sid)) continue
        try { if (typeof 记的.off === 'function') 记的.off() } catch (error) {}
        挂着.delete(sid)
        记账('说话工具已卸下（' + 短id(sid) + '）')
      }
    } catch (error) {
      记账('挂工具心跳出错：' + String((error && error.message) || error))
    }
  }

  // ---------- 路由（给设置页 / 手动测试用）----------
  const 回 = (res, obj) => {
    try {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(obj))
    } catch (error) {}
  }
  const 读体 = (req) => new Promise((resolve) => {
    let 全 = ''
    req.on('data', (c) => { 全 += c; if (全.length > 1e6) req.destroy() })
    req.on('end', () => { try { resolve(全 ? JSON.parse(全) : {}) } catch (error) { resolve({}) } })
    req.on('error', () => resolve({}))
  })
  const 路线 = (路径, handler) =>
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: 路径,
      handler: async (req, res) => {
        try { await handler(req, res) } catch (error) { 回(res, { ok: false, 说: String((error && error.message) || error) }) }
      },
    }))

  const P = '/dsh-voice-edge'

  routeState()
  function routeState() {
    路线(P + '/state', async (req, res) => {
      回(res, {
        ok: true,
        版本: '0.0.1',
        配置: 读配置(),
        配置文件,
        出目录,
        桥配置: 读桥配置().绑定 || [],
        挂着的会话: [...挂着.keys()].map((x) => 短id(x)),
        日志: 日志.slice(-40).map((x) => ({ 时间: 格式时间(x.时间), 文本: x.文本 })),
      })
    })
  }

  路线(P + '/save', async (req, res) => {
    const 来 = await 读体(req)
    const 新 = { ...读配置(), ...(来 && typeof 来 === 'object' ? 来 : {}) }
    if (!写配置(新)) return 回(res, { ok: false, 说: '写不进配置文件' })
    记账('设置已保存：嗓音 ' + 新.嗓音 + '｜' + (新.总开关 ? '开着' : '关着'))
    回(res, { ok: true, 配置: 读配置() })
  })

  路线(P + '/say', async (req, res) => {
    const 来 = await 读体(req)
    const 文字 = String(来.text || '').trim()
    if (!文字) return 回(res, { ok: false, 说: 'body 里给 text' })
    const 桥 = 读桥配置()
    const 行 = (桥.绑定 || []).find((b) => b.类型 === (来.类型 || '私聊')) || (桥.绑定 || [])[0]
    if (!行) return 回(res, { ok: false, 说: '桥那边一条绑定都没有，先去「通到 QQ」里绑一个' })
    回(res, await 说给谁(文字, 行))
  })

  路线(P + '/voices', async (req, res) => {
    const mod = await 拿语音模块()
    if (!mod) return 回(res, { ok: false, 说: '合成模块没装上' })
    try {
      const tts = new mod.MsEdgeTTS()
      const 们 = await tts.getVoices()
      try { tts.close() } catch (error) {}
      回(res, { ok: true, 嗓音: 们.filter((v) => /zh-CN|zh-TW|zh-HK/.test(v.Locale || '')).map((v) => ({ 名: v.ShortName, 性别: v.Gender, 标签: v.VoiceTag })) })
    } catch (error) {
      回(res, { ok: false, 说: String((error && error.message) || error) })
    }
  })

  // 心跳：挂工具 + 清旧的
  ctx.setInterval ? ctx.setInterval(挂工具心跳, 4000) : setInterval(挂工具心跳, 4000)
  挂工具心跳()
  记账('voice-edge 起来了：嗓音 ' + 读配置().嗓音 + '（发 QQ 复用通到 QQ 的绑定）')
}