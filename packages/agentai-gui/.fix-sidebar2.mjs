import { readFileSync, writeFileSync } from 'fs';
const p = 'packages/agentai-gui/src/components/PulseFlowSidebar.tsx';
let c = readFileSync(p, 'utf-8');

const bottom = `
      {/* Bottom: user info + settings */}
      <div style={{borderTop:"1px solid var(--border)",padding:"8px 10px",display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:26,height:26,borderRadius:"50%",flexShrink:0,
          background:"linear-gradient(135deg, #6366F1 0%, #EC4899 100%)",
          display:"inline-flex",alignItems:"center",justifyContent:"center",
          color:"#fff",fontSize:12,fontWeight:700}}>
          {(profile?.name?.charAt(0) || "U").toUpperCase()}
        </div>
        <div style={{flex:1,fontSize:12,fontWeight:600,color:"var(--fg)",
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {profile?.name || "未登录"}
        </div>
        <button onClick={()=>window.dispatchEvent(new CustomEvent("agentai:navigate",{detail:{page:"settings"}}))}
          style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
          width:24,height:24,padding:0,background:"transparent",border:"none",
          color:"var(--muted-2)",cursor:"pointer",borderRadius:4,fontSize:12}}>
          {"⚙"}
        </button>
      </div>
    </div>`;

// Insert the new bottom section before the closing </div> and );
c = c.replace(
  '    </div>\n  );\n};',
  bottom
);

writeFileSync(p, c, 'utf-8');
console.log('Done');
