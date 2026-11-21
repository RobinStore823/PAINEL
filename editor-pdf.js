(()=>{
 const $=id=>document.getElementById(id),lib=window.PDFLib;
 let inputBytes=null,fields=[],doc=null,previewUrl=null,filename='documento.pdf';
 const message=(m,bad=false)=>{$('message').textContent=m;$('message').className='notice'+(bad?' danger':'');};
 const key=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const preview=blob=>{if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);$('preview').src=previewUrl;};
 function widget(field){
   const div=document.createElement('div');div.className='field';
   const label=document.createElement('label');label.textContent=field.getName();div.append(label);
   let input;
   if(field instanceof lib.PDFCheckBox){input=document.createElement('input');input.type='checkbox';input.checked=field.isChecked();input.style.width='auto';}
   else if(field instanceof lib.PDFDropdown || field instanceof lib.PDFRadioGroup){input=document.createElement('select');const empty=document.createElement('option');empty.value='';empty.textContent='— Selecione —';input.append(empty);
     for(const opt of field.getOptions()){const item=document.createElement('option');item.textContent=opt;item.value=opt;input.append(item);}}
   else if(field instanceof lib.PDFTextField){input=document.createElement('input');input.type='text';input.maxLength=500;input.value=field.getText()||'';}
   else {const unsupported=document.createElement('small');unsupported.textContent='Campo não editável neste módulo';div.append(unsupported);return div;}
   input.dataset.pdfField=field.getName();div.append(input);return div;
 }
 function profileFill(){
   for(const input of $('fields').querySelectorAll('[data-pdf-field]')){
     if(input.type==='checkbox')continue;
     const k=key(input.dataset.pdfField);
     if(/(fullname|nomecompleto|applicantname|studentname|^nome$|^name$)/.test(k))input.value=$('profile-name').value;
     else if(/(email|correioeletronico)/.test(k))input.value=$('profile-email').value;
     else if(/(^date$|^data$|dataatual|today)/.test(k))input.value=$('profile-date').value;
   }
   message('Campos compatíveis preenchidos. Revise tudo antes de salvar.');
 }
 async function readFile(file){
   if(!lib)throw Error('Biblioteca de PDF não carregou. Verifique a conexão.');
   if(file.size>10*1024*1024)throw Error('Arquivo maior que 10 MB.');
   const data=await file.arrayBuffer();
   if(new TextDecoder().decode(data.slice(0,5))!=='%PDF-')throw Error('Arquivo não parece ser um PDF válido.');
   const pdf=await lib.PDFDocument.load(data,{updateMetadata:false});
   if(pdf.getPageCount()>30)throw Error('Mais de 30 páginas.');
   return {data,pdf};
 }
 $('file').onchange=async e=>{
   $('fields').replaceChildren();inputBytes=null;doc=null;fields=[];$('save').disabled=true;$('autofill').disabled=true;
   try{
     const file=e.target.files[0];if(!file)return;
     const loaded=await readFile(file);inputBytes=loaded.data;doc=loaded.pdf;filename=file.name;
     fields=doc.getForm().getFields();
     for(const field of fields)$('fields').append(widget(field));
     if(!fields.length)$('fields').textContent='Este PDF não possui campos interativos. Você ainda pode adicionar uma observação.';
     $('file-info').textContent=`${filename} • ${doc.getPageCount()} página(s) • ${fields.length} campo(s) detectado(s)`;
     $('save').disabled=false;$('autofill').disabled=!fields.length;
     preview(new Blob([inputBytes],{type:'application/pdf'}));message('Arquivo pronto. Você pode preencher os campos e criar uma cópia editada.');
   }catch(err){message(err.message,true);$('file-info').textContent='Falha ao abrir PDF.';}
 };
 $('autofill').onclick=profileFill;
 $('save').onclick=async()=>{
   if(!inputBytes)return;
   $('save').disabled=true;
   try{
     const pdf=await lib.PDFDocument.load(inputBytes,{updateMetadata:false});const form=pdf.getForm();
     for(const input of $('fields').querySelectorAll('[data-pdf-field]')){
       const field=form.getField(input.dataset.pdfField);
       if(field instanceof lib.PDFCheckBox){input.checked?field.check():field.uncheck();}
       else if(field instanceof lib.PDFTextField){field.setText(input.value);}
       else if((field instanceof lib.PDFDropdown||field instanceof lib.PDFRadioGroup)&&input.value){field.select(input.value);}
     }
     const note=$('note').value.trim();
     if(note){
       const p=pdf.getPages()[0],font=await pdf.embedFont(lib.StandardFonts.Helvetica);
       const safe=note.replace(/[^\x20-\x7e]/g,'?').slice(0,180);
       const size=9, lines=safe.match(/.{1,85}/g)||[];
       const width=p.getWidth(),height=p.getHeight();
       p.drawRectangle({x:26,y:25,width:Math.max(10,width-52),height:Math.max(26,lines.length*13+21),color:lib.rgb(1,0.96,0.78),opacity:0.95});
       p.drawText('COPIA EDITADA - OBSERVACAO DO TITULAR',{x:34,y:25+lines.length*13+5,size:8,font,color:lib.rgb(.40,.23,.08)});
       for(let i=0;i<lines.length;i++)p.drawText(lines[i],{x:34,y:25+(lines.length-i-1)*13,size,font,color:lib.rgb(.18,.18,.18)});
     }
     // Rotula a cópia quando há alterações e conserva a autoria do emissor intacta.
     if(fields.length>0||note){const pg=pdf.getPages()[0];pg.drawText('COPIA EDITADA',{
       x:30,y:pg.getHeight()-20,size:8,font:await pdf.embedFont(lib.StandardFonts.Helvetica),color:lib.rgb(.5,.1,.1)});}
     const bytes=await pdf.save();
     const blob=new Blob([bytes],{type:'application/pdf'});preview(blob);
     const anchor=document.createElement('a'),url=URL.createObjectURL(blob);anchor.href=url;anchor.download=filename.replace(/\.pdf$/i,'')+'-editado.pdf';anchor.click();
     setTimeout(()=>URL.revokeObjectURL(url),10000);
     message('Cópia gerada no seu computador. Revise o PDF antes de utilizá-lo.');
   }catch(err){message('Não foi possível salvar: '+err.message,true);}finally{$('save').disabled=false;}
 };
 $('reset').onclick=()=>location.reload();
})();
