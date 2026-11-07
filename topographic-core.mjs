const NEIGHBORS=Object.freeze([
  [0,-1], [1,-1], [1,0], [1,1], [0,1], [-1,1], [-1,0], [-1,-1]
]);

export function utmZoneForLongitude(longitude){
  if(!Number.isFinite(longitude)||longitude<-180||longitude>180)throw new RangeError('Invalid longitude');
  return Math.min(60,Math.max(1,Math.floor((longitude+180)/6)+1));
}

export function projectToUtm(longitude,latitude,zone=utmZoneForLongitude(longitude)){
  const a=6378137,e2=0.00669438,ep2=e2/(1-e2),k0=0.9996;
  const phi=latitude*Math.PI/180,lambda=longitude*Math.PI/180,lambda0=((zone-1)*6-180+3)*Math.PI/180;
  const sin=Math.sin(phi),cos=Math.cos(phi),tan=Math.tan(phi),n=a/Math.sqrt(1-e2*sin*sin),t=tan*tan,c=ep2*cos*cos,aa=cos*(lambda-lambda0);
  const m=a*((1-e2/4-3*e2*e2/64-5*e2*e2*e2/256)*phi-(3*e2/8+3*e2*e2/32+45*e2*e2*e2/1024)*Math.sin(2*phi)+(15*e2*e2/256+45*e2*e2*e2/1024)*Math.sin(4*phi)-(35*e2*e2*e2/3072)*Math.sin(6*phi));
  return [500000+k0*n*(aa+(1-t+c)*aa**3/6+(5-18*t+t*t+72*c-58*ep2)*aa**5/120),k0*(m+n*tan*(aa*aa/2+(5-t+9*c+4*c*c)*aa**4/24+(61-58*t+t*t+600*c-330*ep2)*aa**6/720))+(latitude<0?10000000:0)];
}

export function inverseUtm(x,y,zone,northern=true){
  const a=6378137,e2=0.00669438,k0=0.9996,ep2=e2/(1-e2),e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const xx=x-500000,yy=northern?y:y-10000000,m=yy/k0,mu=m/(a*(1-e2/4-3*e2*e2/64-5*e2*e2*e2/256));
  const j1=3*e1/2-27*e1**3/32,j2=21*e1*e1/16-55*e1**4/32,j3=151*e1**3/96,j4=1097*e1**4/512;
  const fp=mu+j1*Math.sin(2*mu)+j2*Math.sin(4*mu)+j3*Math.sin(6*mu)+j4*Math.sin(8*mu);
  const sin=Math.sin(fp),cos=Math.cos(fp),tan=Math.tan(fp),c1=ep2*cos*cos,t1=tan*tan,n1=a/Math.sqrt(1-e2*sin*sin),r1=a*(1-e2)/Math.pow(1-e2*sin*sin,1.5),d=xx/(n1*k0),q1=n1*tan/r1,q2=d*d/2,q3=(5+3*t1+10*c1-4*c1*c1-9*ep2)*d**4/24,q4=(61+90*t1+298*c1+45*t1*t1-252*ep2-3*c1*c1)*d**6/720;
  const q5=d,q6=(1+2*t1+c1)*d**3/6,q7=(5-2*c1+28*t1-3*c1*c1+8*ep2+24*t1*t1)*d**5/120;
  const lon0=((zone-1)*6-180+3)*Math.PI/180;
  return [(lon0+(q5-q6+q7)/cos)*180/Math.PI,(fp-q1*(q2-q3+q4))*180/Math.PI];
}

export function pointInRing(point,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i],[xj,yj]=ring[j],cross=((yi>point[1])!==(yj>point[1]))&&(point[0]<(xj-xi)*(point[1]-yi)/(yj-yi)+xi);
    if(cross)inside=!inside;
  }
  return inside;
}
export function pointInProjectedPolygon(point,rings){
  if(!Array.isArray(rings)||!rings.length||!pointInRing(point,rings[0]))return false;
  return !rings.slice(1).some(ring=>pointInRing(point,ring));
}

function priorityFlood(width,height,elevation,valid){
  const count=width*height,filled=new Float64Array(count),visited=new Uint8Array(count),heap=[];
  const push=(index,value)=>{
    let at=heap.length;heap.push([index,value]);
    while(at>0){const parent=(at-1)>>1;if(heap[parent][1]<=value)break;heap[at]=heap[parent];at=parent;}heap[at]=[index,value];
  };
  const pop=()=>{
    const root=heap[0],last=heap.pop();
    if(heap.length){let at=0;while(true){let child=at*2+1;if(child>=heap.length)break;if(child+1<heap.length&&heap[child+1][1]<heap[child][1])child++;if(heap[child][1]>=last[1])break;heap[at]=heap[child];at=child;}heap[at]=last;}
    return root;
  };
  const seed=i=>{if(valid[i]&&!visited[i]){visited[i]=1;filled[i]=elevation[i];push(i,elevation[i]);}};
  for(let x=0;x<width;x++){seed(x);seed((height-1)*width+x)}
  for(let y=1;y<height-1;y++){seed(y*width);seed(y*width+width-1)}
  while(heap.length){
    const [index,level]=pop(),x=index%width,y=Math.floor(index/width);
    for(const [dx,dy] of NEIGHBORS){
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;
      const next=ny*width+nx;if(!valid[next]||visited[next])continue;
      visited[next]=1;filled[next]=Math.max(elevation[next],level);push(next,filled[next]);
    }
  }
  for(let i=0;i<count;i++)if(valid[i]&&!visited[i])filled[i]=elevation[i];
  return filled;
}

/** Calculate first-pass terrain metrics from a real, projected DEM grid. */
export function analyzeTerrainGrid({width,height,elevation,valid,inside,cellSizeX,cellSizeY}){
  const count=width*height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||count>262144||elevation.length!==count||valid.length!==count||inside.length!==count||!Number.isFinite(cellSizeX)||!Number.isFinite(cellSizeY)||cellSizeX<=0||cellSizeY<=0)throw new RangeError('Invalid terrain grid');
  const elevations=Float64Array.from(elevation),validMask=Uint8Array.from(valid),insideMask=Uint8Array.from(inside),filled=priorityFlood(width,height,elevations,validMask);
  const slopeDeg=new Array(count).fill(null),slopePct=new Array(count).fill(null),flowDir=new Array(count).fill(255),accum=new Float64Array(count),pooling=new Array(count).fill(false),drainage=new Array(count).fill(false);
  const sourceValues=[];
  for(let i=0;i<count;i++)if(validMask[i]&&insideMask[i]){sourceValues.push(elevations[i]);accum[i]=1}
  if(sourceValues.length<4)throw new RangeError('Insufficient DEM cells inside the selected field');
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;if(!validMask[i])continue;
    const z0=elevations[i-width-1],z1=elevations[i-width],z2=elevations[i-width+1],z3=elevations[i-1],z4=elevations[i+1],z5=elevations[i+width-1],z6=elevations[i+width],z7=elevations[i+width+1];
    const neighbors=[i-width-1,i-width,i-width+1,i-1,i+1,i+width-1,i+width,i+width+1];
    if(neighbors.some(n=>!validMask[n]))continue;
    const dx=((z2+2*z4+z7)-(z0+2*z3+z5))/(8*cellSizeX),dy=((z5+2*z6+z7)-(z0+2*z1+z2))/(8*cellSizeY),rise=Math.hypot(dx,dy);
    slopeDeg[i]=Math.atan(rise)*180/Math.PI;slopePct[i]=rise*100;
    let best=0;
    for(let d=0;d<NEIGHBORS.length;d++){
      const [ox,oy]=NEIGHBORS[d],nx=x+ox,ny=y+oy,ni=ny*width+nx;if(!validMask[ni])continue;const drop=filled[i]-filled[ni],distance=Math.hypot(ox*cellSizeX,oy*cellSizeY);
      if(drop>0.000001&&drop/distance>best){best=drop/distance;flowDir[i]=d;}
    }
    const fillDepth=filled[i]-elevations[i];if(insideMask[i]&&fillDepth>=0.5)pooling[i]=true;
  }
  const order=[];for(let i=0;i<count;i++)if(validMask[i])order.push(i);
  order.sort((a,b)=>filled[b]-filled[a]);
  for(const i of order){const d=flowDir[i];if(d===255)continue;const x=i%width,y=Math.floor(i/width),[dx,dy]=NEIGHBORS[d],ni=(y+dy)*width+x+dx;if(ni>=0&&ni<count&&validMask[ni])accum[ni]+=accum[i];}
  const threshold=Math.max(3,Math.ceil(sourceValues.length*0.025));
  for(let i=0;i<count;i++)if(insideMask[i]&&accum[i]>=threshold)drainage[i]=true;
  const slopes=[],slopePercents=[];for(let i=0;i<count;i++)if(insideMask[i]&&slopeDeg[i]!==null){slopes.push(slopeDeg[i]);slopePercents.push(slopePct[i]);}
  const minimum=Math.min(...sourceValues),maximum=Math.max(...sourceValues),meanSlope=slopes.length?slopes.reduce((a,b)=>a+b,0)/slopes.length:null,meanSlopePercent=slopePercents.length?slopePercents.reduce((a,b)=>a+b,0)/slopePercents.length:null,cellArea=cellSizeX*cellSizeY,poolCount=pooling.reduce((n,v)=>n+(v?1:0),0),insideCount=sourceValues.length;
  return {
    stats:{minimum_elevation_m:minimum,maximum_elevation_m:maximum,mean_slope_degrees:meanSlope,mean_slope_percent:meanSlopePercent,low_area_m2:poolCount*cellArea,low_cells:poolCount,valid_cells:insideCount,low_area_donum:poolCount*cellArea/2500},
    grid:{elevation_m:Array.from(elevations,(v,i)=>validMask[i]&&insideMask[i]?v:null),slope_degrees:slopeDeg.map((v,i)=>insideMask[i]?v:null),slope_percent:slopePct.map((v,i)=>insideMask[i]?v:null),flow_direction:flowDir.map((v,i)=>insideMask[i]?v:255),flow_accumulation:Array.from(accum,(v,i)=>insideMask[i]?Math.round(v):0),pooling:pooling.map((v,i)=>insideMask[i]?v:false),drainage_path:drainage.map((v,i)=>insideMask[i]?v:false)},
    thresholds:{depression_depth_m:0.5,drainage_accumulation_cells:threshold},
    cell_area_m2:cellArea
  };
}
