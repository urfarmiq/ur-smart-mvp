// A branch-based automatic Pages build must finish before the redirect artifact.
// The owner may later select Settings > Pages > Source > GitHub Actions once.
const repository=process.env.GITHUB_REPOSITORY,sha=process.env.GITHUB_SHA,token=process.env.GITHUB_TOKEN;
if(!/^urfarmiq\/ur-smart-mvp$/.test(repository||'')||!/^[a-f0-9]{40}$/i.test(sha||'')||!token)throw Error('Repository, commit and Actions token are required.');
let absent=0,ready=false;
for(let attempt=0;attempt<80;attempt++){
 const response=await fetch(`https://api.github.com/repos/${repository}/actions/runs?head_sha=${sha}&per_page=100`,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Cannot verify the automatic Pages build (HTTP '+response.status+'). Actions read permission is required.');
 const body=await response.json(),legacy=(body.workflow_runs||[]).filter(run=>run.name==='pages build and deployment');
 if(legacy.length&&legacy.every(run=>run.status==='completed')){ready=true;break;}
 if(!legacy.length&&++absent>=3){ready=true;break;}
 await new Promise(resolve=>setTimeout(resolve,4000));
}
if(!ready)throw Error('Automatic Pages build is still active; the redirect was not published.');
console.log('The redirect can be published after the automatic branch build.');
