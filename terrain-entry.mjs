// Carry the field already selected on an existing screen into terrain analysis.
// This module neither reads a session nor changes any existing field workflow.
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for(const link of document.querySelectorAll('[data-terrain-field-select]')){
 const select=document.getElementById(link.dataset.terrainFieldSelect);
 if(!select)continue;
 const update=()=>{link.href='./terrain.html'+(id.test(select.value)?'?field='+encodeURIComponent(select.value):'');};
 select.addEventListener('change',update);link.addEventListener('click',update);update();
}
