const Mustache = require('mustache');
const fs = require('fs');
const fmt = JSON.parse(fs.readFileSync('../pdf-service/format-config/table-of-contents.json','utf8')).config;
const data = { caseName: "John Doe vs State", documentList: [
  {index:1, documentName:"Complaint", pageNumber:1},
  {index:2, documentName:"Vakalath", pageNumber:3}
]};
const str = JSON.stringify(fmt);
const rendered = Mustache.render(str, data);
console.log("---- raw rendered string (snippet around body) ----");
console.log(rendered.slice(rendered.indexOf('"body"'), rendered.indexOf('"body"')+400));
try {
  const obj = JSON.parse(rendered);
  console.log("\n---- JSON.parse OK. table.body: ----");
  console.log(JSON.stringify(obj.content[1].table.body, null, 1));
} catch(e){
  console.log("\n!! JSON.parse FAILED:", e.message);
}
