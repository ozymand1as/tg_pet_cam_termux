fetch("/api/settings").then(r=>r.json()).then(s=>{console.log(s);document.body.insertAdjacentHTML("beforeend","<pre>"+JSON.stringify(s,null,2)+"</pre>");});
