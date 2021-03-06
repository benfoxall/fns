importScripts('recast.js')
const viewer = () => fetch('view.html')
/*SPLIT*/

// only intercept requests when there's an active page
let active

// make active non-null for n milliseconds
const touch = (n=1000) => {
  clearTimeout(active)
  active = setTimeout(() => active = null, n)
}
touch()

// listen for pings from frontend to keep rewriting alive
const meta = new BroadcastChannel('fns-meta')
meta.onmessage = (ev) => {
  if(ev.data === 'ping') touch(5000)
}

const basename = str =>  {
  const match = str.match(/https?:\/\/.*\/(.*)/)
  if(match) return match[1]
  return str
}

const viewerURL = location.href.replace(/\.js$/, '.html')

console.log(
  '%c fns service worker running: visit %s to view calls',
  'background: #222; color: #bada55;font-size:1.2em',
  viewerURL
)


addEventListener('fetch', event => {

  if(event.request.url == viewerURL) {
    touch()
    return event.respondWith(viewer())
  }

  if(active === null) return
  if (event.request.method != 'GET') return;

  const request = event.request

  const name = basename(event.request.url)


  // todo - maybe use headers
  if(name.match(/\.js$/)) {

    const wrapName = '_' + Math.random().toString(32).split('.')[1]

    event.respondWith(async function() {

      event.request.mode = 'cors'

      const resp = await fetch(event.request)

      // console.log("RESPONSE", resp.)

      if(resp.type == 'opaque') {
        console.log(`unable to rewrite ${name} (opaque)`)
        return resp
      }

      const code = await resp.text()

      meta.postMessage(JSON.stringify({
        log: `rewriting ${name}`
      }))

      const b = recast.types.builders
      const ast = recast.parse(code)

      let count = 1
      recast.types.visit(ast, {

        visitFunction: function(path) {
          const node = path.node

          const track = b.expressionStatement(b.callExpression(
            b.identifier(wrapName),
            [b.numericLiteral(count++)]
          ))

          try {
            path.get("body", "body").unshift(track)
          } catch (e) {
            console.log('unable to instrument function')
          }


          this.traverse(path)
        }
      })

      const output = recast.print(ast).code

      meta.postMessage(JSON.stringify({
        log: `served ${name}`
      }))

      return new Response(
        `console.log('Instrumented: ${name} - ${count}fns ${wrapName}')

        const ${wrapName} = (() => {

          const channel = new BroadcastChannel('fns')
          channel.postMessage({
            url: '${event.request.url}',
            max: ${count}
          })

          let calls
          const report = () => {
            channel.postMessage({
              url: '${event.request.url}',
              max: ${count},
              calls: calls
            })
            calls = null
          }

          return function(id) {
            if(!calls) {calls = []; setTimeout(report, 0)}
            calls.push(id)
          }

        })();

        ${output}
        `
      )

    }());
  }
})
