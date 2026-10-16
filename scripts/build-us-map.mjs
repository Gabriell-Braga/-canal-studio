// One-time generator of remotion/public/maps/us-states.json: lower-48 state outlines from
// us-atlas (ISC, https://github.com/topojson/us-atlas), projected with projectUs.
// Run: npx tsx scripts/build-us-map.mjs
import { writeFileSync } from 'fs'
import { MAP_SIZE, projectUs } from '../shared/visuals.ts'

const topo = await (await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json')).json()
const { scale, translate } = topo.transform
// Quantized, delta-encoded arcs → lon/lat.
const arcs = topo.arcs.map((arc) => {
  let x = 0
  let y = 0
  return arc.map(([dx, dy]) => {
    x += dx
    y += dy
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]]
  })
})
const arcPoints = (i) => (i < 0 ? [...arcs[~i]].reverse() : arcs[i])
const ring = (ids) => ids.flatMap((i, k) => (k ? arcPoints(i).slice(1) : arcPoints(i)))

const SKIP = new Set(['02', '15', '60', '66', '69', '72', '78'])
const states = []
for (const g of topo.objects.states.geometries) {
  if (SKIP.has(g.id)) continue
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs
  let d = ''
  for (const poly of polys)
    for (const r of poly) {
      const pts = []
      for (const [lon, lat] of ring(r)) {
        const { x, y } = projectUs(lon, lat)
        const last = pts.at(-1)
        if (last && Math.hypot(last[0] - x, last[1] - y) < 0.8) continue
        pts.push([x, y])
      }
      if (pts.length < 3) continue
      d += 'M' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + 'Z'
    }
  states.push({ id: g.id, name: g.properties.name, d })
}
const out = JSON.stringify({ ...MAP_SIZE, states })
writeFileSync(new URL('../remotion/public/maps/us-states.json', import.meta.url), out)
console.log(states.length, 'states,', Math.round(out.length / 1024), 'KB')
