import { buildSync } from 'esbuild';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export function engine(amount: number): Uint8Array {
  const contents = `
    import {createKernel,parseGameData,hashGameDataBundle} from '@void/shared-core';
    import {captureKernel} from './captureKernel';
    import {currentProjection} from './projection';
    export const projection={...currentProjection,visibleView:(state,viewer,data)=>{
      const result=currentProjection.visibleView(state,viewer,data);
      return {...result,view:{...result.view,players:{...result.view.players,[viewer]:{...result.view.players[viewer],name:'view-${amount}'}}}};
    }};
    export const drivers={ai:()=>[],bot:()=>[],slices:a=>a.map(x=>[x]),pve:()=>[],standing:()=>[],canonicalStanding:()=>[]};
    export const formatVersion=1, sourceRevision='${'a'.repeat(40)}', manifestVersion='104';
    export const data=parseGameData({version:'same-data',resources:['credits'],units:{},buildings:{},factions:{},events:{}});
    export const dataHash=hashGameDataBundle(data);
    const module={id:'fixture',version:'1.0.0',setup(api){api.onAction('fixture.spend',(a,h)=>{
      h.state.players[a.playerId].resources.credits-=${amount};
    });}};
    export const {kernel,actions}=captureKernel(createKernel,[module]);
    export const configFor=()=>({timeScale:1,victory:{scoreLimit:${amount * 100}}});
  `;
  return buildSync({ stdin: { contents, resolveDir: dirname(fileURLToPath(import.meta.url)), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', minify: true }).outputFiles[0]!.contents;
}
