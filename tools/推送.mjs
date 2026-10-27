// 用 GitHub 的接口把当前目录推上去
//
// 为什么需要它：有些网络（比如这台机器）连不上 github.com:443，`git push` 直接超时；
// 但 api.github.com 是通的。这个脚本用「Git 数据接口」把工作区当成一个快照提交上去，
// 不需要 git 传输。
//
// 用法：
//   $env:GH_TOKEN='ghp_xxx'; node tools/推送.mjs "提交信息"
//   node tools/推送.mjs "提交信息" --私有       （建仓库时用：仓库不存在就顺手建）
//   node tools/推送.mjs "提交信息" --强制       （历史对不上时强推）
//
// token 只从环境变量读，不落盘、不写进仓库。

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const 根 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const 令牌 = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
const 消息 = process.argv[2] || '更新'
const 私有 = process.argv.includes('--私有')
const 强制 = process.argv.includes('--强制')

if (!令牌) {
  console.error('没给 token。先 $env:GH_TOKEN = "ghp_..." 再跑。')
  process.exit(2)
}

const 包 = JSON.parse(fs.readFileSync(path.join(根, 'package.json'), 'utf8'))
const 仓库地址 = String(包.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '')
const 匹配 = /github\.com[/:]([^/]+)\/([^/]+)$/.exec(仓库地址)
if (!匹配) {
  console.error('package.json 里没有可用的 repository.url：' + 仓库地址)
  process.exit(2)
}
const [, 主人, 仓库] = 匹配

const 接口 = 'https://api.github.com'
const 头 = {
  authorization: 'Bearer ' + 令牌,
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-voice-edge-push',
  'x-github-api-version': '2022-11-28',
}
async function 发(方法, 路径, 体) {
  const r = await fetch(接口 + 路径, {
    method: 方法,
    headers: { ...头, ...(体 ? { 'content-type': 'application/json' } : {}) },
    body: 体 ? JSON.stringify(体) : undefined,
  })
  const j = await r.json().catch(() => null)
  return { 码: r.status, j }
}

// 工作区里要推的文件（跟 git 看到的一致：尊重 .gitignore）
// ⚠️ 必须 -z：文件名里有中文时，git 默认把路径转义成 \346\216\250 这种，读出来是坏路径
const 文件们 = execSync('git -c core.quotepath=false ls-files -z', { cwd: 根 })
  .toString('utf8').split(String.fromCharCode(0)).filter(Boolean)

// 仓库在不在
let 仓库信息 = await 发('GET', `/repos/${主人}/${仓库}`)
if (仓库信息.码 === 404) {
  console.log('远端没有这个仓库，建一个…')
  仓库信息 = await 发('POST', '/user/repos', {
    name: 仓库,
    description: String(包.description || ''),
    private: 私有,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    auto_init: false,
  })
  if (仓库信息.码 >= 300) { console.error('建仓库失败：', JSON.stringify(仓库信息.j).slice(0, 300)); process.exit(1) }
  console.log('建好了：' + 仓库信息.j.full_name)
}

const 分支 = 仓库信息.j?.default_branch || 'main'

// 当前分支的提交（空仓库会 404）
let 父 = null
const 现有 = await 发('GET', `/repos/${主人}/${仓库}/git/ref/heads/${分支}`)
if (现有.码 === 200 && 现有.j?.object?.sha) 父 = 现有.j.object.sha

// 空仓库：GitHub 不让直接写 blob，先用内容接口把 README 塞进去「点着」
if (!父) {
  const 种子 = 文件们.includes('README.md') ? 'README.md' : 文件们[0]
  const 内容 = fs.readFileSync(path.join(根, 种子)).toString('base64')
  const r = await 发('PUT', `/repos/${主人}/${仓库}/contents/${种子}`, { message: '初始化仓库', content: 内容 })
  if (r.码 >= 300) { console.error('初始化失败：', JSON.stringify(r.j).slice(0, 300)); process.exit(1) }
  父 = r.j.commit.sha
  console.log('仓库点着了：' + 父.slice(0, 7))
}

// 每个文件 → blob
const 树项 = []
for (const f of 文件们) {
  const 字节 = fs.readFileSync(path.join(根, f))
  const b = await 发('POST', `/repos/${主人}/${仓库}/git/blobs`, { content: 字节.toString('base64'), encoding: 'base64' })
  if (b.码 >= 300) { console.error(`blob 失败 ${f}：`, JSON.stringify(b.j).slice(0, 200)); process.exit(1) }
  树项.push({ path: f.split(path.sep).join('/'), mode: '100644', type: 'blob', sha: b.j.sha })
  console.log('  blob ' + f + ' → ' + b.j.sha.slice(0, 8))
}

// 树 → 提交
const 树 = await 发('POST', `/repos/${主人}/${仓库}/git/trees`, { tree: 树项 })
if (树.码 >= 300) { console.error('建树失败：', JSON.stringify(树.j).slice(0, 300)); process.exit(1) }
const 提交 = await 发('POST', `/repos/${主人}/${仓库}/git/commits`, {
  message: 消息,
  tree: 树.j.sha,
  parents: 强制 ? [] : [父],
  author: { name: 包.author?.name || 主人, email: 包.author?.email || 主人 + '@users.noreply.github.com' },
})
if (提交.码 >= 300) { console.error('建提交失败：', JSON.stringify(提交.j).slice(0, 300)); process.exit(1) }

const 更新 = await 发('PATCH', `/repos/${主人}/${仓库}/git/refs/heads/${分支}`, { sha: 提交.j.sha, force: 强制 })
if (更新.码 >= 300) { console.error('更新分支失败：', JSON.stringify(更新.j).slice(0, 300)); process.exit(1) }

console.log('')
console.log('推上去了：https://github.com/' + 主人 + '/' + 仓库 + '/commit/' + 提交.j.sha)