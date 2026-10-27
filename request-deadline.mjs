export class RequestDeadlineError extends Error {
 constructor(){super('استغرق الاتصال وقتًا أطول من المتوقع. أعد المحاولة.');this.name='RequestDeadlineError';}
}

// A deadline ends the UI wait; it does not erase sessions or bypass SDK locks.
// Callers must apply results only after this promise succeeds.
export function withDeadline(operation,milliseconds=12000){
 let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new RequestDeadlineError()),milliseconds);});
 return Promise.race([Promise.resolve(operation),deadline]).finally(()=>clearTimeout(timer));
}
