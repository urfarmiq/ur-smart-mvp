// Terrain screening on a north-to-south, pixel-centred geographic DEM grid.
// No elevations are created, holes filled, or unresolved flat flow invented.
const R=6371008.8,DEG=Math.PI/180,MAX_CELLS=40000,MAX_VERTICES=512,EPS=1e-11;
const STEPS=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
export const ALGORITHM_VERSION='ur-terrain-v1';
export class TerrainAnalysisError extends Error{
 constructor(message,code='invalid_terrain'){super(message);this.name='TerrainAnalysisError';this.code=code;this.status=422;}
}
const fail=(message,code)=>{throw new TerrainAnalysisError(message,code);};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const rounded=value=>Number.isFinite(value)?Math.round(value*1000)/1000:null;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
function onSegment(p,a,b){return Math.abs(cross(a,b,p))<=EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;}
function intersects(a,b,c,d){
 const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);
 return ((ab1>EPS&&ab2< -EPS)||(ab1< -EPS&&ab2>EPS))&&((cd1>EPS&&cd2< -EPS)||(cd1< -EPS&&cd2>EPS))||onSegment(c,a,b)||onSegment(d,a,b)||onSegment(a,c,d)||onSegment(b,c,d);
}
function inRing(point,ring,includeBoundary=true){
 let inside=false;
 for(let i=0,j=ring.length-2;i<ring.length-1;j=i++){
  const a=ring[j],b=ring[i];if(onSegment(point,a,b))return includeBoundary;
  if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
function inside(point,rings){return inRing(point,rings[0],true)&&!rings.slice(1).some(ring=>inRing(point,ring,true));}
function ringArea(ring){let sum=0;for(let i=1;i<ring.length;i++)sum+=(ring[i][0]-ring[i-1][0])*DEG*(2+Math.sin(ring[i-1][1]*DEG)+Math.sin(ring[i][1]*DEG));return Math.abs(sum)*R*R/2;}
function distance(a,b){const dlat=(b[1]-a[1])*DEG,dlon=(b[0]-a[0])*DEG,q=Math.sin(dlat/2)**2+Math.cos(a[1]*DEG)*Math.cos(b[1]*DEG)*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(Math.min(1,q)));}

export function validateTerrainPolygon(value){
 let polygon=value;
 if(typeof polygon==='string'){try{polygon=JSON.parse(polygon);}catch{fail('حدود الحقل ليست GeoJSON صالحًا.');}}
 if(polygon?.type==='Feature')polygon=polygon.geometry;
 if(polygon?.type!=='Polygon'||!Array.isArray(polygon.coordinates)||!polygon.coordinates.length||polygon.coordinates.length>32)fail('اختر حدود حقل من نوع مضلع صالح.');
 const rings=polygon.coordinates;let vertices=0;
 for(const ring of rings){
  if(!Array.isArray(ring)||ring.length<4)fail('يجب إغلاق حدود الحقل بثلاث زوايا على الأقل.');
  vertices+=ring.length;if(vertices>MAX_VERTICES)fail('الحدود معقدة جدًا؛ بسّط المضلع قبل التحليل.','boundary_limit');
  for(const point of ring)if(!Array.isArray(point)||point.length!==2||!point.every(finite)||Math.abs(point[0])>180||point[1]< -80||point[1]>84)fail('إحداثيات حدود الحقل غير صالحة.');
  if(!same(ring[0],ring.at(-1))||new Set(ring.slice(0,-1).map(p=>p.join(','))).size!==ring.length-1)fail('الحدود غير مغلقة أو تتضمن زوايا مكررة.');
  for(let i=0;i<ring.length-1;i++)for(let j=i+1;j<ring.length-1;j++){
   if(j===i+1||i===0&&j===ring.length-2)continue;
   if(intersects(ring[i],ring[i+1],ring[j],ring[j+1]))fail('حدود الحقل تتقاطع مع نفسها.');
  }
 }
 for(let a=0;a<rings.length;a++)for(let b=a+1;b<rings.length;b++){
  for(let i=0;i<rings[a].length-1;i++)for(let j=0;j<rings[b].length-1;j++)if(intersects(rings[a][i],rings[a][i+1],rings[b][j],rings[b][j+1]))fail('لا يجوز تقاطع حدود الحقل والفراغات الداخلية أو تلامسها.');
  if(a>0&&(inRing(rings[a][0],rings[b])||inRing(rings[b][0],rings[a])))fail('الفراغات الداخلية متداخلة.');
 }
 for(const hole of rings.slice(1))if(!inRing(hole[0],rings[0],false))fail('يوجد فراغ داخلي خارج حدود الحقل.');
 let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
 for(const p of rings[0]){west=Math.min(west,p[0]);east=Math.max(east,p[0]);south=Math.min(south,p[1]);north=Math.max(north,p[1]);}
 if(east-west>1||north-south>1)fail('الحدود أكبر من نطاق تحليل الحقل المدعوم.','boundary_limit');
 const area=ringArea(rings[0])-rings.slice(1).reduce((sum,ring)=>sum+ringArea(ring),0);
 if(!finite(area)||area<=0)fail('مساحة حدود الحقل غير صالحة.');
 if(area>2e7||distance([west,south],[east,north])>30000)fail('حجم الحقل يتجاوز حد التحليل الحالي البالغ ٢٠ كيلومترًا مربعًا.','boundary_limit');
 return {polygon:{type:'Polygon',coordinates:rings.map(ring=>ring.map(p=>[...p]))},bounds:[west,south,east,north],area_m2:rounded(area),area_dunam:rounded(area/2500),centroid:[(west+east)/2,(south+north)/2]};
}

function validateRaster(raster,field){
 if(!raster||!Number.isInteger(raster.width)||!Number.isInteger(raster.height)||raster.width<3||raster.height<3||raster.width>512||raster.height>512||raster.width*raster.height>MAX_CELLS)fail('شبكة الارتفاعات غير صالحة أو أكبر من حد المعالجة.','raster_limit');
 const {width,height,bounds,elevations}=raster;
 if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(finite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]||Math.abs(bounds[0])>180||Math.abs(bounds[2])>180||bounds[1]< -80||bounds[3]>84)fail('نطاق شبكة الارتفاعات غير صالح.');
 if(!(Array.isArray(elevations)||ArrayBuffer.isView(elevations))||elevations.length!==width*height)fail('عدد قيم الارتفاع لا يطابق أبعاد الشبكة.');
 for(const z of elevations)if(z!==null&&(!finite(z)||z< -12000||z>10000))fail('تتضمن شبكة الارتفاعات قيمة غير صالحة؛ لا يمكن إنشاء تقرير موثوق.');
 if(field.bounds[0]<bounds[0]-EPS||field.bounds[1]<bounds[1]-EPS||field.bounds[2]>bounds[2]+EPS||field.bounds[3]>bounds[3]+EPS)fail('مصدر الارتفاعات لا يغطي حدود الحقل كاملة.','incomplete_dem');
 if(!raster.source||typeof raster.source.id!=='string'||!raster.source.id||typeof raster.source.name!=='string'||!raster.source.name||!finite(raster.source.resolution_m)||raster.source.resolution_m<=0)fail('بيانات مصدر الارتفاع ودقته مطلوبة للتحليل.');
 const xStep=(bounds[2]-bounds[0])/width,yStep=(bounds[3]-bounds[1])/height;
 return {width,height,bounds,elevations,xStep,yStep,dx:R*DEG*xStep*Math.cos((bounds[1]+bounds[3])/2*DEG),dy:R*DEG*yStep};
}
function coordinate(i,grid){const x=i%grid.width,y=Math.floor(i/grid.width);return [grid.bounds[0]+(x+.5)*grid.xStep,grid.bounds[3]-(y+.5)*grid.yStep];}
function neighbors(i,width,height,fn){const x=i%width,y=Math.floor(i/width);for(let d=0;d<8;d++){const nx=x+STEPS[d][0],ny=y+STEPS[d][1];if(nx>=0&&nx<width&&ny>=0&&ny<height)fn(ny*width+nx,d);}}
class MinHeap{
 constructor(){this.items=[];}
 push(index,level){const item={index,level},a=this.items;a.push(item);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p].level<=level)break;a[i]=a[p];i=p;}a[i]=item;}
 pop(){const a=this.items,root=a[0],last=a.pop();if(a.length){let i=0;while(true){let c=i*2+1;if(c>=a.length)break;if(c+1<a.length&&a[c+1].level<a[c].level)c++;if(a[c].level>=last.level)break;a[i]=a[c];i=c;}a[i]=last;}return root;}
 get length(){return this.items.length;}
}
function depressionAnalysis(grid,mask){
 const {width,height,elevations:z}=grid,n=width*height,levels=new Float64Array(n),parent=new Int32Array(n).fill(-1),visited=new Uint8Array(n),heap=new MinHeap();let unknownBoundary=false;
 for(let i=0;i<n;i++)if(mask[i]&&z[i]!==null){
  const x=i%width,y=Math.floor(i/width);let edge=x===0||y===0||x===width-1||y===height-1;
  neighbors(i,width,height,j=>{if(!mask[j])edge=true;else if(z[j]===null){edge=true;unknownBoundary=true;}});
  if(edge){visited[i]=1;levels[i]=z[i];heap.push(i,z[i]);}
 }
 while(heap.length){const current=heap.pop();neighbors(current.index,width,height,j=>{if(visited[j]||!mask[j]||z[j]===null)return;visited[j]=1;parent[j]=current.index;levels[j]=Math.max(z[j],current.level);heap.push(j,levels[j]);});}
 const depth=new Array(n).fill(null),low=new Array(n).fill(null),threshold=.1;
 for(let i=0;i<n;i++)if(mask[i]&&z[i]!==null){depth[i]=rounded(Math.max(0,levels[i]-z[i]));low[i]=depth[i]>=threshold;}
 return {depth,low,parent,threshold,unknownBoundary};
}
function pathResult(indices,grid,kind,id,rings){
 const coordinates=[];let length=0,truncated=false;
 for(const i of indices){
  const next=coordinate(i,grid),last=coordinates.at(-1);
  if(last&&!segmentInside(last,next,rings)){truncated=true;break;}
  if(last)length+=distance(last,next);coordinates.push(next);
 }
 if(coordinates.length<2)return null;
 let note=kind==='depression_escape'?'ممر أولي من منخفض وفق مسار الانسكاب في الشبكة؛ قد يصعد فوق الأرض الحالية ويتطلب حفرًا. لا يؤكد وجود مخرج صرف قانوني أو فعّال.':'ممر يتبع الجريان الهابط المحسوب داخل الحقل فقط؛ يلزم تحديد المخرج والمنسوب والحفر ميدانيًا قبل اعتماد مبزل.';
 if(truncated)note+=' أُوقف الممر عند اقترابه من حد أو فراغ مستبعد لم تعالجه دقة الشبكة.';
 return {id,coordinates,length_m:rounded(length),kind,outfall_verified:false,requires_survey:true,boundary_truncated:truncated,note_ar:note};
}
function drainagePaths(grid,mask,flow,accum,depression,rings){
 const paths=[],covered=new Uint8Array(mask.length),candidates=[];
 for(let i=0;i<mask.length;i++)if(depression.low[i])candidates.push(i);
 candidates.sort((a,b)=>depression.depth[b]-depression.depth[a]);
 for(const start of candidates){
  if(paths.length>=4)break;if(covered[start])continue;
  const pending=[start];covered[start]=1;while(pending.length){const p=pending.pop();neighbors(p,grid.width,grid.height,j=>{if(depression.low[j]&&!covered[j]){covered[j]=1;pending.push(j);}});}
  const chain=[start];let current=start;
  while(depression.parent[current]>=0&&chain.length<=mask.length){current=depression.parent[current];chain.push(current);}
  if(chain.length>1){const path=pathResult(chain,grid,'depression_escape','depression-'+(paths.length+1),rings);if(path)paths.push(path);}
 }
 if(paths.length<4){
  const used=new Uint8Array(mask.length),ordered=[];for(let i=0;i<mask.length;i++)if(mask[i]&&flow[i]>=0&&accum[i]>=3)ordered.push(i);
  ordered.sort((a,b)=>accum[b]-accum[a]);
  for(const seed of ordered){
   if(paths.length>=4)break;if(used[seed])continue;
   const upstream=[seed];let at=seed;
   // Extend back along the largest observed within-field contributing branch.
   while(upstream.length<mask.length){let best=-1;neighbors(at,grid.width,grid.height,j=>{if(mask[j]&&flow[j]===at&&!used[j]&&(best<0||accum[j]>accum[best]))best=j;});if(best<0)break;upstream.push(best);at=best;}
   const chain=upstream.reverse();at=seed;while(flow[at]>=0&&mask[flow[at]]&&!used[flow[at]]&&chain.length<mask.length){at=flow[at];chain.push(at);}
   if(chain.length>=3){for(const i of chain)used[i]=1;const path=pathResult(chain,grid,'natural_flow','flow-'+(paths.length+1),rings);if(path)paths.push(path);}
  }
 }
 return paths;
}

export function analyzeTerrain({polygon,raster}={}){
 const field=validateTerrainPolygon(polygon),grid=validateRaster(raster,field),{width,height,elevations:z,dx,dy}=grid,n=width*height,rings=field.polygon.coordinates;
 const mask=new Array(n).fill(false),valid=[],elevations=new Array(n).fill(null),slopeDegrees=new Array(n).fill(null),slopePercent=new Array(n).fill(null),directions=new Array(n).fill(null),accumulation=new Array(n).fill(null),flow=new Int32Array(n).fill(-1);let nominal=0;
 for(let i=0;i<n;i++){mask[i]=inside(coordinate(i,grid),rings);if(mask[i]){nominal++;if(z[i]!==null){valid.push(i);elevations[i]=rounded(z[i]);accumulation[i]=1;}}}
 if(valid.length<4)fail('لا توجد خلايا ارتفاع صالحة كافية داخل الحقل. قد يكون الحقل أصغر من دقة DEM؛ يلزم رفع مساحي أدق.','insufficient_dem');
 const coverage=100*valid.length/nominal;if(coverage<80)fail('تغطية بيانات الارتفاع أقل من ٨٠٪ من خلايا الحقل؛ لم يُنشأ تقرير ناجح.','incomplete_dem');
 let slopeCount=0,slopeSum=0,percentSum=0,min=Infinity,max=-Infinity,total=0,maxSlope=0,maxPercent=0,unresolved=0,partialDerivatives=0;
 for(const i of valid){
  const x=i%width,y=Math.floor(i/width);min=Math.min(min,z[i]);max=Math.max(max,z[i]);total+=z[i];
  const at=(xx,yy)=>xx>=0&&xx<width&&yy>=0&&yy<height?z[yy*width+xx]:null;
  const nw=at(x-1,y-1),no=at(x,y-1),ne=at(x+1,y-1),we=at(x-1,y),ea=at(x+1,y),sw=at(x-1,y+1),so=at(x,y+1),se=at(x+1,y+1);
  let gx=null,gy=null;
  if([nw,no,ne,we,ea,sw,so,se].every(finite)){gx=((ne+2*ea+se)-(nw+2*we+sw))/(8*dx);gy=((sw+2*so+se)-(nw+2*no+ne))/(8*dy);}
  else{
   gx=finite(ea)&&finite(we)?(ea-we)/(2*dx):finite(ea)?(ea-z[i])/dx:finite(we)?(z[i]-we)/dx:null;
   gy=finite(no)&&finite(so)?(so-no)/(2*dy):finite(so)?(so-z[i])/dy:finite(no)?(z[i]-no)/dy:null;
   if(gx!==null&&gy!==null)partialDerivatives++;
  }
  if(gx!==null&&gy!==null){const ratio=Math.hypot(gx,gy),degrees=Math.atan(ratio)/DEG,percent=ratio*100;slopeDegrees[i]=rounded(degrees);slopePercent[i]=rounded(percent);slopeCount++;slopeSum+=degrees;percentSum+=percent;maxSlope=Math.max(maxSlope,degrees);maxPercent=Math.max(maxPercent,percent);}
  let best=-1,dir=-1,bestGradient=0;
  neighbors(i,width,height,(j,d)=>{if(z[j]===null)return;const drop=z[i]-z[j],step=Math.hypot(STEPS[d][0]*dx,STEPS[d][1]*dy),gradient=drop/step;if(drop>1e-6&&gradient>bestGradient){bestGradient=gradient;best=j;dir=d;}});
  flow[i]=best;directions[i]=dir;if(best<0)unresolved++;
 }
 if(slopeCount<Math.max(3,valid.length*.7))fail('لا تتوفر نقاط مجاورة صالحة تكفي لحساب انحدار الحقل.','insufficient_dem');
 const order=[...valid].sort((a,b)=>z[b]-z[a]);for(const i of order)if(flow[i]>=0&&mask[flow[i]]&&accumulation[flow[i]]!==null)accumulation[flow[i]]+=accumulation[i];
 const depression=depressionAnalysis(grid,mask),arrows=[],stride=Math.max(1,Math.ceil(Math.sqrt(valid.length/180)));let lowCells=0,maxDepth=0;
 for(const i of valid){if(depression.low[i]){lowCells++;maxDepth=Math.max(maxDepth,depression.depth[i]);}if(flow[i]>=0&&i%width%stride===0&&Math.floor(i/width)%stride===0)arrows.push({from:coordinate(i,grid),to:coordinate(flow[i],grid),drop_m:rounded(z[i]-z[flow[i]]),direction:directions[i],leaves_field:!mask[flow[i]]});}
 const lowArea=Math.min(field.area_m2,lowCells*dx*dy),relief=max-min;
 const warnings=[
  'تحليل تقديري لشبكة DEM، وليس قياس LiDAR أو رفعًا مساحيًا أو تصميم مبازل هندسيًا نهائيًا.',
  'قد يمثل المصدر سطح الغطاء النباتي والمباني؛ لا يفصل تلقائيًا منسوب سطح التربة تحتها.',
  'في أراضي العراق شبه المستوية قد تكون فروق الارتفاع أصغر من خطأ النموذج الرأسي، فلا تُعتمد مناسيب الحفر أو اتجاهات الصرف دون ميزانية ميدانية.',
  'الجريان والتراكم والمنخفضات محسوبة محليًا ضمن حدود الحقل؛ لا تشمل حوض التصريف الكامل أو المداخل والمبازل والجسور خارج الحدود.',
  'التراكم عدد خلايا مساهمة داخل الحقل، وليس كمية مياه أو توقع فيضان. التربة والمطر والري ومنسوب المياه الجوفية غير ممثلة.',
  'المناطق المنخفضة تقديرات انخفاض هندسي في الشبكة، وليست إثباتًا لوجود تجمع ماء فعلي أو عمق ماء متوقع.',
  'عتبة فرز الانخفاضات الحسابية ٠٫١ متر لتجاهل الفروق العددية الصغيرة؛ لا تعني أن DEM يستطيع كشف منخفضات حقلية بعمق عشرة سنتيمترات.',
  'حدود المساحات المظللة تقريبية بحجم خلايا الشبكة؛ التفاصيل والفراغات الأصغر من الخلية لا تُحل بهذا المصدر.'
 ];
 const verticalAccuracy=raster.source.nominal_vertical_accuracy_m??raster.source.vertical_accuracy_m;
 if(finite(verticalAccuracy)&&verticalAccuracy>0){
  warnings.push('مؤشر الدقة الرأسية الاسمي المنشور للمصدر ليس هامش خطأ مقاسًا لهذا الحقل ولا ضمانًا لدقة مناسيب المبازل.');
  if(relief<=verticalAccuracy)warnings.push('مدى ارتفاع الحقل لا يتجاوز مؤشر الدقة الرأسية الاسمي المنشور للمصدر؛ قد لا يميز هذا النموذج تفاصيل الانحدار والتصريف الصغيرة.');
  if(lowCells&&maxDepth<=verticalAccuracy)warnings.push('أعماق الانخفاضات المحسوبة لا تتجاوز مؤشر الدقة الرأسية الاسمي للمصدر؛ قد تمثل ضوضاء DEM أو الغطاء السطحي، ولا تؤكد أحواض تجمع حقيقية.');
 }
 if(coverage<100)warnings.push('توجد خلايا بلا بيانات داخل الحقل؛ أُبقيت فارغة ولم تُستبدل بارتفاعات مفترضة.');
 if(depression.unknownBoundary)warnings.push('خلايا بلا بيانات تلامس نطاق الصرف؛ مسارات الانسكاب والمنخفضات قربها غير مكتملة.');
 if(unresolved)warnings.push('لم يُفرض اتجاه جريان على الخلايا المستوية أو القيعان التي لا تملك جارًا أخفض في النموذج.');
 if(partialDerivatives)warnings.push('بعض ميول الخلايا تستخدم فروقًا مجاورة جزئية عند حدود البيانات بدل نافذة Horn الكاملة.');
 if(!lowCells)warnings.push('عدم رصد منخفض مغلق في هذه الشبكة لا ينفي تجمع الماء محليًا بين خلايا النموذج أو بسبب التربة وسوء الصرف.');
 const recommendations=[
  'قارن المواضع المنخفضة مع آثار الماء بعد المطر أو الري، وافحص نفاذية التربة وانسداد المخارج قبل التدخل.',
  'اربط أي مبزل بمخرج صرف مصرح ومتحقق من منسوبه، واطلب رفعًا مساحيًا لتحديد ميله وعمقه ومقطعه.',
  'راجع شبكة الري والتسوية الدقيقة مع مختص؛ لا تستخدم هذه الخريطة وحدها لتحديد أعمال حفر أو تغيير صرف الأراضي المجاورة.'
 ];
 if(lowCells)recommendations.unshift('ابدأ المعاينة الميدانية في المناطق المنخفضة المعلّمة، مع قياس المناسيب لتأكيد الحاجة إلى مبازل أو تسوية.');
 return {schema_version:1,algorithm_version:ALGORITHM_VERSION,status:'completed',polygon:field.polygon,bounds:field.bounds,area_m2:field.area_m2,area_dunam:field.area_dunam,source:{...raster.source},summary:{min_elevation_m:rounded(min),max_elevation_m:rounded(max),mean_elevation_m:rounded(total/valid.length),mean_slope_degrees:rounded(slopeSum/slopeCount),mean_slope_percent:rounded(percentSum/slopeCount),max_slope_degrees:rounded(maxSlope),max_slope_percent:rounded(maxPercent),valid_cells:valid.length,coverage_percent:rounded(coverage)},raster:{width,height,bounds:[...grid.bounds],elevations,slope_degrees:slopeDegrees,slope_percent:slopePercent,flow_direction:directions,flow_accumulation:accumulation,low_mask:depression.low,depression_depth_m:depression.depth,field_mask:mask},flow_arrows:arrows,low_areas:{area_m2:rounded(lowArea),area_dunam:rounded(lowArea/2500),fraction_percent:rounded(100*lowArea/field.area_m2),cells:lowCells,max_depth_m:rounded(maxDepth),method:'priority_flood_field_boundary_open',min_screening_depth_m:depression.threshold,threshold_note_ar:'عتبة فرز حسابية؛ ليست دقة كشف انخفاضات حقلية بعشرة سنتيمترات.'},drainage_paths:drainagePaths(grid,mask,flow,accumulation,depression,rings),warnings,recommendations,diagnostics:{algorithm:'Horn slope / strict downhill D8 / field-local priority flood',horizontal_units:'metres',slope_units:['degrees','percent'],accumulation_units:'within_field_cells',flow_direction_encoding:'0E 1SE 2S 3SW 4W 5NW 6N 7NE; -1 unresolved; null outside/no-data',cell_spacing_x_m:rounded(dx),cell_spacing_y_m:rounded(dy),area_estimate_method:'spherical polygon minus holes; low-area pixel-centre approximation',slope_valid_cells:slopeCount,unresolved_flow_cells:unresolved,context:'field_boundary_only',vertical_datum:raster.source.vertical_datum||'see_source_metadata'}};
}

function segmentInside(a,b,rings){
 const ts=[0,1],vx=b[0]-a[0],vy=b[1]-a[1];
 for(const ring of rings)for(let i=1;i<ring.length;i++){
  const c=ring[i-1],d=ring[i],wx=d[0]-c[0],wy=d[1]-c[1],det=vx*wy-vy*wx;
  if(Math.abs(det)>1e-16){const t=((c[0]-a[0])*wy-(c[1]-a[1])*wx)/det,u=((c[0]-a[0])*vy-(c[1]-a[1])*vx)/det;if(t>0&&t<1&&u>=0&&u<=1)ts.push(t);}
  else for(const p of [c,d])if(onSegment(p,a,b)){const t=Math.abs(vx)>Math.abs(vy)?(p[0]-a[0])/vx:(p[1]-a[1])/vy;if(t>0&&t<1)ts.push(t);}
 }
 ts.sort((x,y)=>x-y);for(let i=1;i<ts.length;i++){const t=(ts[i]+ts[i-1])/2;if(!inside([a[0]+vx*t,a[1]+vy*t],rings))return false;}return true;
}
function interpolate(point,grid){
 const x=(point[0]-grid.bounds[0])/grid.xStep-.5,y=(grid.bounds[3]-point[1])/grid.yStep-.5,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
 const at=(xx,yy)=>xx>=0&&xx<grid.width&&yy>=0&&yy<grid.height?grid.elevations[yy*grid.width+xx]:null;
 const values=[at(x0,y0),at(x0+1,y0),at(x0,y0+1),at(x0+1,y0+1)];
 if(values.every(finite))return (values[0]*(1-fx)+values[1]*fx)*(1-fy)+(values[2]*(1-fx)+values[3]*fx)*fy;
 // An exact centre is a measured source pixel, even beside no-data.
 if(Math.abs(x-Math.round(x))<1e-7&&Math.abs(y-Math.round(y))<1e-7)return at(Math.round(x),Math.round(y));
 return null;
}
export function sampleTerrainProfile({polygon,raster,line,samples=128}={}){
 const field=validateTerrainPolygon(polygon),grid=validateRaster(raster,field),points=line?.type==='LineString'?line.coordinates:line;
 if(!Array.isArray(points)||points.length<2||points.length>32||points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(finite)))fail('ارسم خط مقطع صالحًا داخل الحقل.','invalid_profile');
 if(!Number.isInteger(samples)||samples<2||samples>512)fail('عدد نقاط المقطع خارج الحد المسموح.','invalid_profile');
 for(const p of points)if(!inside(p,field.polygon.coordinates))fail('يجب أن يقع خط المقطع بالكامل داخل الحقل وخارج الفراغات الداخلية.','profile_outside_field');
 const lengths=[0];for(let i=1;i<points.length;i++){if(!segmentInside(points[i-1],points[i],field.polygon.coordinates))fail('يمر جزء من خط المقطع خارج حدود الحقل أو داخل فراغ مستبعد.','profile_outside_field');lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));}
 const length=lengths.at(-1);if(length<1)fail('خط المقطع قصير جدًا؛ ارسم خطًا أطول من متر.','invalid_profile');
 const result=[];let segment=1;
 for(let i=0;i<samples;i++){const distance_m=length*i/(samples-1);while(segment<lengths.length-1&&distance_m>lengths[segment])segment++;const a=points[segment-1],b=points[segment],part=lengths[segment]-lengths[segment-1],t=part?(distance_m-lengths[segment-1])/part:0,coordinate=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],elevation=interpolate(coordinate,grid);result.push({distance_m:rounded(distance_m),elevation_m:rounded(elevation),coordinate});}
 const values=result.map(p=>p.elevation_m).filter(finite);if(values.length<2)fail('لا توجد قياسات ارتفاع كافية على الخط؛ لم تُنشأ قيم بديلة.','insufficient_profile');
 return {line:{type:'LineString',coordinates:points.map(p=>[...p])},length_m:rounded(length),samples:result,min_elevation_m:Math.min(...values),max_elevation_m:Math.max(...values),valid_samples:values.length,interpolation:'bilinear where four source pixels exist; gaps stay null',warning_ar:'المقطع مشتق من DEM بالدقة المبينة للمصدر، وليس ميزانية ميدانية. تبقى فجوات البيانات فارغة.'};
}
