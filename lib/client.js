// DSH「小鱼的声音」· 网页半边
//
// 在 **DSH 设置** 左侧栏加一项「小鱼的声音」：选嗓音、试听、调速、开关。
// ⚠ 这里不合成、不发消息，只是往宿主那几条 /dsh-voice-edge/* 路由上读写。
window.__ModuleLoader__.load({
  id: 'dsh-voice-edge',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']

    const B = '/dsh-voice-edge'
    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const post = (p, body) =>
      fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then((r) => r.json())
        .catch(() => null)

    const h = React.createElement

    const S = {
      wrap: {
        padding: '12px 14px 24px', fontSize: 13, lineHeight: 1.7,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))', borderRadius: 12,
      },
      h: { fontSize: 14, fontWeight: 600, margin: '16px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12 },
      card: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 },
      行: { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', flexWrap: 'wrap' },
      标签: { minWidth: 76, opacity: 0.75 },
      输入: {
        padding: '4px 8px', borderRadius: 6, fontSize: 13,
        border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
        color: 'var(--dsw-alias-text-1, inherit)',
      },
      好: { color: '#2e8b57' },
      坏: { color: '#c0392b' },
    }

    const 按钮 = (文字, 点, 主 = false, 忙 = false) =>
      h('button', {
        onClick: 忙 ? undefined : 点,
        disabled: !!忙,
        style: { ...S.输入, cursor: 忙 ? 'default' : 'pointer', opacity: 忙 ? 0.6 : 1, fontWeight: 主 ? 600 : 400, padding: '5px 12px' },
      }, 忙 ? '…' : 文字)

    const 语速们 = ['-30%', '-20%', '-10%', '0%', '+10%', '+20%', '+30%']
    const 音调们 = ['-20Hz', '-10Hz', '0Hz', '+10Hz', '+20Hz', '+30Hz']

    function Section() {
      const [态, set态] = React.useState(null)
      const [配置, set配置] = React.useState(null)
      const [嗓音们, set嗓音们] = React.useState([])
      const [脏, set脏] = React.useState(false)
      const [忙, set忙] = React.useState(false)
      const [测试句, set测试句] = React.useState('主人，我是小鱼。这条是试听。')
      const [说, set说] = React.useState('')
      const [下载中, set下载中] = React.useState(false)

      const 拉 = async () => {
        const s = await get('/state')
        if (s && s.ok) { set态(s); set配置(s.配置 || {}); set脏(false) }
        const v = await get('/voices')
        if (v && v.ok) set嗓音们(v.嗓音 || [])
      }
      React.useEffect(() => { void 拉() }, [])

      const 改 = (键, 值) => { set配置((c) => ({ ...(c || {}), [键]: 值 })); set脏(true) }

      const 存 = async () => {
        set忙(true)
        const r = await post('/save', 配置)
        set忙(false)
        if (r && r.ok) { set配置(r.配置); set脏(false); set说('保存好了') } else set说('没保存上：' + ((r && r.说) || '？'))
        void 拉()
      }

      const 下载 = async () => {
        set下载中(true)
        const r = await post('/下载离线模型', {})
        set说(r && r.ok ? '开始下了，等它跑一会儿（约 20MB）' : '没开始：' + ((r && r.说) || '？'))
        for (let i = 0; i < 80; i++) {
          await new Promise((x) => setTimeout(x, 3000))
          const s2 = await get('/state')
          if (s2 && s2.ok) {
            set态(s2)
            if (!s2.下载 || !s2.下载.进行中) break
          }
        }
        set下载中(false)
        void 拉()
      }

      const 试听 = async () => {
        set忙(true)
        const r = await post('/say', { text: 测试句, 类型: '私聊' })
        set忙(false)
        set说(r && r.ok ? '发出去了，去 QQ 听听' : '没发出去：' + ((r && r.说) || '？'))
        void 拉()
      }

      if (!配置) return h('div', { style: S.wrap }, '读取中…')

      const 桥 = (态 && 态.桥配置) || []
      const 日志 = (态 && 态.日志) || []

      return h('div', { style: S.wrap },
        h('div', { style: S.h }, '小鱼的声音'),
        h('div', { style: S.dim },
          '把想说的话合成成语音，直接发到 QQ。合成走 Node，不用 Python；'
          + '发到哪儿复用「通到 QQ」的绑定。版本 ' + String((态 && 态.版本) || '?')),
        h('div', { style: S.dim }, '配置文件：' + String((态 && 态.配置文件) || '')),

        h('div', { style: S.card },
          h('div', { style: S.行 },
            h('span', { style: S.标签 }, '总开关'),
            h('label', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: !!配置.总开关, onChange: (e) => 改('总开关', e.target.checked) }),
              '开着才合成、才发得出去'),
          ),
          h('div', { style: S.行 },
            h('span', { style: S.标签 }, '嗓音'),
            h('select', { style: S.输入, value: 配置.嗓音 || '', onChange: (e) => 改('嗓音', e.target.value) },
              (嗓音们.length ? 嗓音们 : [{ 名: 配置.嗓音 || 'zh-CN-XiaoyiNeural' }]).map((v) =>
                h('option', { key: v.名, value: v.名 },
                  v.名 + (v.性别 ? '（' + v.性别 + '）' : '') + (v.标签 ? ' · ' + String(v.标签).slice(0, 24) : '')),
              ),
            ),
          ),
          h('div', { style: S.行 },
            h('span', { style: S.标签 }, '语速'),
            h('select', { style: S.输入, value: 配置.语速 || '0%', onChange: (e) => 改('语速', e.target.value) },
              [配置.语速, ...语速们].filter((x, i, a) => x && a.indexOf(x) === i).map((x) => h('option', { key: x, value: x }, x)),
            ),
            h('span', { style: { ...S.标签, minWidth: 40 } }, '音调'),
            h('select', { style: S.输入, value: 配置.音调 || '0Hz', onChange: (e) => 改('音调', e.target.value) },
              [配置.音调, ...音调们].filter((x, i, a) => x && a.indexOf(x) === i).map((x) => h('option', { key: x, value: x }, x)),
            ),
            h('span', { style: { ...S.标签, minWidth: 40 } }, '最长'),
            h('input', { type: 'number', min: 20, max: 2000, style: { ...S.输入, width: 80 },
              value: Number(配置.最长字数 || 300), onChange: (e) => 改('最长字数', Number(e.target.value)) }),
            h('span', { style: S.dim }, '字（超了就截断加省略号）'),
          ),
          h('div', { style: S.行 },
            h('span', { style: S.标签 }, '备用嗓音'),
            h('select', { style: S.输入, value: 配置.备用嗓音 || '小模型', onChange: (e) => 改('备用嗓音', e.target.value) },
              [['小模型', '离线小模型（最自然）'], ['windows', 'Windows 自带（音色呆，但零下载）'], ['off', '关掉（只用在线的）']].map(([v, t2]) =>
                h('option', { key: v, value: v }, t2)),
            ),
            h('span', { style: S.dim }, '在线那条不通时，自动换成它'),
          ),
          h('div', { style: S.行 },
            h('span', { style: S.标签 }, '离线模型'),
            (态 && 态.离线模型)
              ? h('span', { style: S.好 }, '已就绪：' + String(态.离线模型).split('\\').pop())
              : 按钮(下载中 ? '下载中…' : '下载离线模型（约 20MB）', 下载, false, 下载中),
            (态 && 态.下载 && 态.下载.进行中)
              ? h('span', { style: S.dim },
                  String(态.下载.步骤 || '') + (态.下载.总 ? ' ' + Math.round(态.下载.已下 / 态.下载.总 * 100) + '%' : (态.下载.已下 ? ' ' + Math.round(态.下载.已下 / 1048576) + ' MB' : '')))
              : null,
            (态 && 态.下载 && 态.下载.错) ? h('span', { style: S.坏 }, '上次没下成：' + 态.下载.错) : null,
          ),
        ),

        h('div', { style: S.card },
          h('div', { style: S.h }, '试听'),
          h('div', { style: S.行 },
            h('input', { style: { ...S.输入, flex: 1, minWidth: 200 }, value: 测试句, onChange: (e) => set测试句(e.target.value) }),
            按钮('发一条到我的 QQ', 试听, true, 忙),
          ),
          h('div', { style: S.dim }, '会真发一条语音到「通到 QQ」里绑的那个私聊。'),
        ),

        h('div', { style: S.card },
          h('div', { style: S.h }, '会发到哪儿'),
          桥.length
            ? 桥.map((b, i) => h('div', { key: i, style: S.行 },
                h('span', { style: S.标签 }, (b.类型 === '群' ? '群 ' : '私聊 ') + b.号码),
                h('span', { style: S.dim }, '→ 会话 ' + String(b.会话 || '').slice(-8) + (b.称呼 ? '（' + b.称呼 + '）' : '')),
              ))
            : h('div', { style: S.坏 }, '「通到 QQ」那边一条绑定都没有 —— 先去那里绑一个，这里才有地方发。'),
          h('div', { style: S.dim }, '说话工具挂上的会话：' + (((态 && 态.挂着的会话) || []).join('、') || '（还没有）')),
        ),

        h('div', { style: S.行 },
          按钮('保存设置', 存, true, 忙),
          脏 ? h('span', { style: S.坏 }, '⚠ 有改动还没保存') : h('span', { style: S.好 }, '设置已同步 ✓'),
          说 ? h('span', { style: S.dim }, 说) : null,
        ),

        h('div', { style: S.card },
          h('div', { style: S.h }, '运行记录'),
          (日志.length ? 日志.slice(-10).reverse() : [{ 时间: '', 文本: '还没有记录' }]).map((x, i) =>
            h('div', { key: i, style: S.dim }, (x.时间 ? x.时间 + '  ' : '') + x.文本),
          ),
        ),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'voice-edge', order: 55, label: () => '小鱼的声音' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})