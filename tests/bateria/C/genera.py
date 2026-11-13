from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import Image, ImageDraw, ImageFont
from zipfile import ZipFile, ZIP_DEFLATED
from pathlib import Path
import tempfile, os, json, shutil
from lxml import etree

OUT=Path(__file__).resolve().parent  # genera los DOCX junto a este script
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'

class Case:
 def __init__(self, stem, kind): self.stem=stem; self.kind=kind; self.data=[]; self.false=[]
 def add(self,text,typ,where='cuerpo',note=''): self.data.append({'texto':text,'tipo':typ,'ubicacion':where,'debe_limpiarse':True,'nota':note})
 def fp(self,text,motivo): self.false.append({'texto':text,'motivo':motivo})
 def savejson(self): (OUT/(self.stem+'.esperado.json')).write_text(json.dumps({'documento':self.stem+'.docx','tipo':self.kind,'datos':self.data,'falsos_positivos':self.false},ensure_ascii=False,indent=2)+'\n')

def ptext(doc, text, boldparts=(), lang=None):
 p=doc.add_paragraph()
 if boldparts:
  pos=0
  for piece,bold in boldparts:
   r=p.add_run(piece); r.bold=bold
 else: p.add_run(text)
 if lang:
  for r in p.runs: r._element.get_or_add_rPr().append(OxmlElement('w:lang')); r._element.rPr[-1].set(qn('w:val'),lang)
 return p

def base_doc(title, header='DNI 12345678Z', footer=''):
 d=Document(); sec=d.sections[0]
 sec.header.paragraphs[0].text=header
 sec.footer.paragraphs[0].text=footer or 'Documento reservado · Página '
 d.add_heading(title,0)
 d.add_paragraph('Expediente ficticio para pruebas de anonimización. Los identificadores y personas de este lote son inventados.')
 return d

def rich_common(d,c, name='Lucía Fernández Varela', dni='12345678Z'):
 d.sections[0].header.paragraphs[0].text='Titular: '+name+' · DNI '+dni
 d.sections[0].footer.paragraphs[0].text='DNI '+dni+' · '+name
 c.add(name,'PERSONA','cabecera','Nombre que aparece en la cabecera.')
 c.add(dni,'DNI','cabecera','DNI que aparece en la cabecera.')
 c.add(name,'PERSONA','pie','Nombre que aparece en el pie.')
 c.add(dni,'DNI','pie','DNI que aparece en el pie.')
 t=d.add_table(rows=2, cols=2); t.style='Table Grid'
 t.cell(0,0).merge(t.cell(0,1)); t.cell(0,0).text='Parte interesada: '+name
 t.cell(1,0).text='DNI: '; t.cell(1,1).text=dni
 c.add(name,'PERSONA','tabla','Celda combinada; el dato se repite en otra parte del documento.')
 c.add(dni,'DNI','tabla','DNI en celda y también partido en runs con negrita parcial.')
 p=d.add_paragraph(); p.add_run('Identificación: '); p.add_run(dni[:4]).bold=True; p.add_run(dni[4:])
 c.add(dni,'DNI','cuerpo','El DNI está partido en varios w:r y la mitad está en negrita.')
 p=d.add_paragraph(); p.add_run('Nombre con salto: Ana Ruiz'); br=OxmlElement('w:br'); p.runs[-1]._r.append(br); p.add_run('Gil')
 c.add('Ana Ruiz\nGil','PERSONA','cuerpo','Nombre con w:br dentro del texto.')
 p=d.add_paragraph(); p.add_run('Teléfono:\t+34 981 234 567')
 c.add('+34 981 234 567','TELEFONO','cuerpo','Separado de la etiqueta mediante w:tab.')
 ptext(d,'Acordo de colaboración subscrito en Santiago de Compostela.',lang='gl-ES')
 c.fp('Expediente ficticio','Texto genérico sin identificador personal.')
 # numbered list
 for s in ['Primero: revisar anexos.','Segundo: validar el original.','Tercero: custodiar la copia.']:
  d.add_paragraph(s,style='List Number')
 # fields in body
 p=d.add_paragraph(); p.add_run('Página '); field(p,'PAGE'); p.add_run(' · '); field(p,'MERGEFIELD Nombre', name)
 c.add(name,'PERSONA','campo','Resultado visible de MERGEFIELD.')
 p=d.add_paragraph(); p.add_run('Contacto por campo: '); field(p,'HYPERLINK \"mailto:secretaria@example.com\"','secretaria@example.com')
 c.add('secretaria@example.com','EMAIL','campo','El valor de HYPERLINK está en el código de campo y en su resultado visible.')

def field(p, instr, result='1'):
 for kind,txt in [('begin',''),('instr',instr),('separate',''),('text',result),('end','')]:
  r=OxmlElement('w:r')
  if kind in ('begin','separate','end'):
   fc=OxmlElement('w:fldChar'); fc.set(qn('w:fldCharType'),kind); r.append(fc)
  elif kind=='instr':
   it=OxmlElement('w:instrText'); it.set('{http://www.w3.org/XML/1998/namespace}space','preserve'); it.text=txt; r.append(it)
  else:
   t=OxmlElement('w:t'); t.text=txt; r.append(t)
  p._p.append(r)

def add_textbox(doc,text):
 p=doc.add_paragraph(); r=OxmlElement('w:r'); pict=OxmlElement('w:pict'); shape=etree.Element('{urn:schemas-microsoft-com:vml}shape'); shape.set('id','TextBox1'); shape.set('style','width:240pt;height:48pt'); tb=OxmlElement('w:txbxContent'); pp=OxmlElement('w:p'); rr=OxmlElement('w:r'); tt=OxmlElement('w:t'); tt.text=text; rr.append(tt); pp.append(rr); tb.append(pp); shape.append(tb); pict.append(shape); r.append(pict); p._p.append(r)

def add_notes(src, foot, end):
 # add simple note parts; relation/CT support
 with ZipFile(src,'r') as zin: files={n:zin.read(n) for n in zin.namelist()}
 for part, noteid, text in [('word/footnotes.xml','1',foot),('word/endnotes.xml','1',end)]:
  root=etree.Element('{%s}%s'%(W,('footnotes' if 'footnotes' in part else 'endnotes')),nsmap={'w':W})
  for idv,typ in [('-1','separator'),('0','continuationSeparator')]:
   n=etree.SubElement(root,'{%s}%s'%(W,'footnote' if 'footnotes' in part else 'endnote')); n.set('{%s}type'%W,typ); n.set('{%s}id'%W,idv)
   p=etree.SubElement(n,'{%s}p'%W); etree.SubElement(p,'{%s}r'%W)
  n=etree.SubElement(root,'{%s}%s'%(W,'footnote' if 'footnotes' in part else 'endnote')); n.set('{%s}id'%W,noteid)
  p=etree.SubElement(n,'{%s}p'%W); r=etree.SubElement(p,'{%s}r'%W); t=etree.SubElement(r,'{%s}t'%W); t.text=text
  files[part]=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
 # document relationships, settings, content types
 relname='word/_rels/document.xml.rels'; relroot=etree.fromstring(files[relname]);
 for typ,target,rid in [('footnotes','footnotes.xml','rIdFoot'),('endnotes','endnotes.xml','rIdEnd')]:
  etree.SubElement(relroot,'{%s}Relationship'%PKG,Id=rid,Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/'+typ,Target=target)
 files[relname]=etree.tostring(relroot,xml_declaration=True,encoding='UTF-8',standalone=True)
 ct=etree.fromstring(files['[Content_Types].xml'])
 for part,typ in [('footnotes','application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml'),('endnotes','application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml')]:
  etree.SubElement(ct,'{%s}Override'%CT,PartName='/word/'+part+'.xml',ContentType=typ)
 files['[Content_Types].xml']=etree.tostring(ct,xml_declaration=True,encoding='UTF-8',standalone=True)
 docroot=etree.fromstring(files['word/document.xml']); body=docroot.find('{%s}body'%W); sect=body.find('{%s}sectPr'%W)
 for tag,rid in [('footnoteReference','rIdFoot'),('endnoteReference','rIdEnd')]:
  p=etree.Element('{%s}p'%W); r=etree.SubElement(p,'{%s}r'%W); el=etree.SubElement(r,'{%s}%s'%(W,tag)); el.set('{%s}id'%R,'1'); body.insert(body.index(sect),p)
 files['word/document.xml']=etree.tostring(docroot,xml_declaration=True,encoding='UTF-8',standalone=True)
 tmp=src.with_suffix('.tmp')
 with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
  for n,b in files.items(): z.writestr(n,b)
 tmp.replace(src)

def add_comment(src, author, text):
 with ZipFile(src,'r') as zin: files={n:zin.read(n) for n in zin.namelist()}
 doc=etree.fromstring(files['word/document.xml']); body=doc.find('{%s}body'%W); p=etree.Element('{%s}p'%W); r=etree.SubElement(p,'{%s}r'%W); t=etree.SubElement(r,'{%s}t'%W); t.text='[Comentario asociado al párrafo anterior]'; body.insert(body.index(body.find('{%s}sectPr'%W)),p)
 etree.SubElement(p,'{%s}commentRangeStart'%W).set('{%s}id'%W,'0'); etree.SubElement(p,'{%s}commentRangeEnd'%W).set('{%s}id'%W,'0')
 rr=etree.SubElement(p,'{%s}r'%W); ref=etree.SubElement(rr,'{%s}commentReference'%W); ref.set('{%s}id'%W,'0')
 files['word/document.xml']=etree.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
 root=etree.Element('{%s}comments'%W,nsmap={'w':W}); c=etree.SubElement(root,'{%s}comment'%W); c.set('{%s}id'%W,'0'); c.set('{%s}author'%W,author); c.set('{%s}initials'%W,'AR'); pp=etree.SubElement(c,'{%s}p'%W); run=etree.SubElement(pp,'{%s}r'%W); tt=etree.SubElement(run,'{%s}t'%W); tt.text=text
 files['word/comments.xml']=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
 relroot=etree.fromstring(files['word/_rels/document.xml.rels']); etree.SubElement(relroot,'{%s}Relationship'%PKG,Id='rIdComments',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',Target='comments.xml'); files['word/_rels/document.xml.rels']=etree.tostring(relroot,xml_declaration=True,encoding='UTF-8',standalone=True)
 ct=etree.fromstring(files['[Content_Types].xml']); etree.SubElement(ct,'{%s}Override'%CT,PartName='/word/comments.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'); files['[Content_Types].xml']=etree.tostring(ct,xml_declaration=True,encoding='UTF-8',standalone=True)
 tmp=src.with_suffix('.tmp')
 with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
  for n,b in files.items(): z.writestr(n,b)
 tmp.replace(src)

def add_track(src, author, inserted, deleted):
 with ZipFile(src,'r') as zin: files={n:zin.read(n) for n in zin.namelist()}
 root=etree.fromstring(files['word/document.xml']); body=root.find('{%s}body'%W); p=etree.Element('{%s}p'%W)
 r=etree.SubElement(p,'{%s}r'%W); t=etree.SubElement(r,'{%s}t'%W); t.text='Texto vigente: '
 ins=etree.SubElement(p,'{%s}ins'%W); ins.set('{%s}id'%W,'12'); ins.set('{%s}author'%W,author); ins.set('{%s}date'%W,'2025-04-03T09:30:00Z'); ir=etree.SubElement(ins,'{%s}r'%W); it=etree.SubElement(ir,'{%s}t'%W); it.text=inserted
 dr=etree.SubElement(p,'{%s}del'%W); dr.set('{%s}id'%W,'13'); dr.set('{%s}author'%W,'Ana Ruiz Gil'); dr.set('{%s}date'%W,'2025-04-02T10:00:00Z'); drr=etree.SubElement(dr,'{%s}r'%W); dt=etree.SubElement(drr,'{%s}delText'%W); dt.text=deleted
 rr=etree.SubElement(p,'{%s}r'%W); rt=etree.SubElement(rr,'{%s}t'%W); rt.text=' · versión actual'
 body.insert(body.index(body.find('{%s}sectPr'%W)),p); files['word/document.xml']=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
 tmp=src.with_suffix('.tmp')
 with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
  for n,b in files.items(): z.writestr(n,b)
 tmp.replace(src)

def add_mailto(src,email):
 with ZipFile(src,'r') as zin: files={n:zin.read(n) for n in zin.namelist()}
 root=etree.fromstring(files['word/document.xml']); body=root.find('{%s}body'%W); p=etree.Element('{%s}p'%W); h=etree.SubElement(p,'{%s}hyperlink'%W); h.set('{%s}id'%R,'rIdMail'); rr=etree.SubElement(h,'{%s}r'%W); t=etree.SubElement(rr,'{%s}t'%W); t.text=email; body.insert(body.index(body.find('{%s}sectPr'%W)),p)
 files['word/document.xml']=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
 relroot=etree.fromstring(files['word/_rels/document.xml.rels']); etree.SubElement(relroot,'{%s}Relationship'%PKG,Id='rIdMail',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',Target='mailto:'+email,TargetMode='External'); files['word/_rels/document.xml.rels']=etree.tostring(relroot,xml_declaration=True,encoding='UTF-8',standalone=True)
 tmp=src.with_suffix('.tmp')
 with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
  for n,b in files.items(): z.writestr(n,b)
 tmp.replace(src)

def add_image(doc, alt, path):
 p=doc.add_paragraph(); r=p.add_run(); r.add_picture(str(path),width=Inches(1.3))
 dr=doc.inline_shapes[-1]._inline.docPr; dr.set('descr',alt); dr.set('title',alt)

def add_thumbnail(src, text):
 im=Image.new('RGB',(700,900),'white'); d=ImageDraw.Draw(im); font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',30); d.text((45,55),text,fill='black',font=font,spacing=14); p=OUT/(src.stem+'_thumb.jpeg'); im.save(p,quality=90)
 with ZipFile(src,'r') as zin: files={n:zin.read(n) for n in zin.namelist()}
 files['docProps/thumbnail.jpeg']=p.read_bytes(); p.unlink()
 rel=etree.fromstring(files['_rels/.rels']);
 for old in list(rel):
  if (old.get('Type') or '').endswith('/thumbnail'): rel.remove(old)
 etree.SubElement(rel,'{%s}Relationship'%PKG,Id='rIdThumb',Type='http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail',Target='docProps/thumbnail.jpeg'); files['_rels/.rels']=etree.tostring(rel,xml_declaration=True,encoding='UTF-8',standalone=True)
 ct=etree.fromstring(files['[Content_Types].xml']); etree.SubElement(ct,'{%s}Default'%CT,Extension='jpeg',ContentType='image/jpeg'); files['[Content_Types].xml']=etree.tostring(ct,xml_declaration=True,encoding='UTF-8',standalone=True)
 tmp=src.with_suffix('.tmp')
 with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
  for n,b in files.items(): z.writestr(n,b)
 tmp.replace(src)

def add_metadata(src, creator, dni):
 with ZipFile(src,'r') as zin: files={n:zin.read(n) for n in zin.namelist()}
 core=etree.fromstring(files['docProps/core.xml']); ns={'dc':'http://purl.org/dc/elements/1.1/','cp':'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'}
 for xp,val in [('//dc:creator',creator),('//cp:lastModifiedBy',creator)]: core.xpath(xp,namespaces=ns)[0].text=val
 files['docProps/core.xml']=etree.tostring(core,xml_declaration=True,encoding='UTF-8',standalone=True)
 app=etree.fromstring(files['docProps/app.xml']); x=app.find('.//Company');
 if x is None: x=etree.SubElement(app,'Company')
 x.text='Bufete Rivera & Asociados'; files['docProps/app.xml']=etree.tostring(app,xml_declaration=True,encoding='UTF-8',standalone=True)
 custom=etree.Element('{http://schemas.openxmlformats.org/officeDocument/2006/custom-properties}Properties',nsmap={'vt':'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'})
 prop=etree.SubElement(custom,'{http://schemas.openxmlformats.org/officeDocument/2006/custom-properties}property',fmtid='{D5CDD505-2E9C-101B-9397-08002B2CF9AE}',pid='2',name='Expediente'); val=etree.SubElement(prop,'{http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes}lpwstr'); val.text='DNI '+dni
 files['docProps/custom.xml']=etree.tostring(custom,xml_declaration=True,encoding='UTF-8',standalone=True)
 # relationship/content type
 rel=etree.fromstring(files['_rels/.rels']); etree.SubElement(rel,'{%s}Relationship'%PKG,Id='rIdCustom',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties',Target='docProps/custom.xml'); files['_rels/.rels']=etree.tostring(rel,xml_declaration=True,encoding='UTF-8',standalone=True)
 ct=etree.fromstring(files['[Content_Types].xml']); etree.SubElement(ct,'{%s}Override'%CT,PartName='/docProps/custom.xml',ContentType='application/vnd.openxmlformats-officedocument.custom-properties+xml'); files['[Content_Types].xml']=etree.tostring(ct,xml_declaration=True,encoding='UTF-8',standalone=True)
 tmp=src.with_suffix('.tmp')
 with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
  for n,b in files.items(): z.writestr(n,b)
 tmp.replace(src)

def write_case(c, doc):
 path=OUT/(c.stem+'.docx'); doc.save(path); c.savejson(); return path

# Image asset reused only during creation
img=OUT/'sello.png'; Image.new('RGB',(240,120),'white').save(img)

# 01 Contrato includes notes, metadata, thumbnail, standard hard structure
c=Case('01_contrato_marco','contrato con partes complejas, notas y metadatos')
d=base_doc('Contrato marco de servicios','DNI 12345678Z · Lucía Fernández Varela','Firma: DNI 12345678Z')
rich_common(d,c)
ptext(d,'Domicilio de notificación: Rúa do Vilar 19, 2.º B, 15705 Santiago de Compostela.')
c.add('Rúa do Vilar 19, 2.º B, 15705 Santiago de Compostela','DIRECCION')
add_textbox(d,'Representante: Lucía Fernández Varela')
c.add('Lucía Fernández Varela','PERSONA','cuadro','Nombre dentro de cuadro de texto VML.')
p=write_case(c,d); add_notes(p,'Nota al pie: Lucía Fernández Varela revisó el anexo.','Nota final: Lucía Fernández Varela recibe copia.'); add_metadata(p,'Lucía Fernández Varela','12345678Z'); add_thumbnail(p,'CONTRATO MARCO\nLucía Fernández Varela\nDNI 12345678Z'); c.add('Lucía Fernández Varela','PERSONA','nota','Nota al pie y nota final; texto de ambas debe sustituirse.')
c.add('Lucía Fernández Varela','PERSONA','metadatos','creator y lastModifiedBy deben quedar vacíos.')
c.add('Bufete Rivera & Asociados','OTRO','metadatos','Company debe quedar vacío.'); c.add('12345678Z','DNI','custom','El valor de Expediente debe anonimizarse en custom.xml.'); c.add('Lucía Fernández Varela','PERSONA','miniatura','Eliminar docProps/thumbnail.jpeg y su relación; la miniatura muestra el dato.'); c.savejson()

# 02 Demanda: comment/mailto
c=Case('02_demanda_civil','demanda civil con comentario e hipervínculo')
d=base_doc('Demanda de reclamación','DNI 87654321X','DNI 87654321X')
rich_common(d,c,'Marcos Souto Neira','87654321X')
ptext(d,'Parte actora: Marcos Souto Neira; NIF 87654321X.')
c.add('Marcos Souto Neira','PERSONA'); c.add('87654321X','DNI')
p=write_case(c,d); add_comment(p,'Elena Vázquez','Llamar al +34 611 222 333 antes de presentar.'); c.add('Elena Vázquez','PERSONA','comentario','El autor del comentario debe quedar vacío.'); c.add('+34 611 222 333','TELEFONO','comentario','El contenido del comentario debe anonimizarse.')
add_mailto(p,'marcos.souto@example.com'); c.add('marcos.souto@example.com','EMAIL','hyperlink','Texto visible y relación mailto deben limpiarse.'); c.savejson()

# 03 Informe medico: tracked changes, image alt
c=Case('03_informe_medico','informe médico con control de cambios e imagen')
d=base_doc('Informe clínico ficticio','DNI 23456789A','Paciente: Irene Calvo Nogueira')
rich_common(d,c,'Irene Calvo Nogueira','23456789A'); add_image(d,'Irene Calvo Nogueira - paciente',img)
c.add('Irene Calvo Nogueira','PERSONA','imagen_alt','descr/title de wp:docPr deben sustituirse por etiqueta.')
p=write_case(c,d); add_track(p,'Ana Ruiz Gil','Irene Calvo Nogueira','DNI 23456789A'); c.add('Ana Ruiz Gil','PERSONA','control_cambios_insertado','El autor del cambio insertado debe quedar vacío.'); c.add('Irene Calvo Nogueira','PERSONA','control_cambios_insertado','El texto insertado se conserva como versión vigente y debe anonimizarse.'); c.add('23456789A','DNI','control_cambios_eliminado','El texto eliminado no se ve en la versión final y debe retirarse completamente.'); c.savejson()

# 04 Acta asamblea: comment + track
c=Case('04_acta_asamblea','acta con comentarios y control de cambios')
d=base_doc('Acta de asamblea','DNI 34567890B','Secretaria: Ana Ruiz Gil')
rich_common(d,c,'Ana Ruiz Gil','34567890B'); p=write_case(c,d); add_track(p,'Ana Ruiz Gil','Ana Ruiz Gil','DNI 34567890B'); add_comment(p,'Pablo Estévez','Confirmar teléfono +34 622 444 555 con la secretaria.');
c.add('Ana Ruiz Gil','PERSONA','control_cambios_insertado','Conservar inserción pero vaciar author.'); c.add('34567890B','DNI','control_cambios_eliminado','Retirar el w:del completo; el DNI no figura en texto final.'); c.add('Pablo Estévez','PERSONA','comentario','Vaciar autor del comentario.'); c.add('+34 622 444 555','TELEFONO','comentario','Limpiar número contenido en comentario.'); c.savejson()

# 05 carta con mailto + image alt
c=Case('05_carta_requerimiento','carta con hipervínculo mailto e imagen con alt text')
d=base_doc('Requerimiento de pago','DNI 45678901C','Remitente: Xoán Paz Loureiro · DNI 45678901C')
rich_common(d,c,'Xoán Paz Loureiro','45678901C'); add_image(d,'Xoán Paz Loureiro',img); c.add('Xoán Paz Loureiro','PERSONA','imagen_alt','Eliminar la repetición del nombre en descr/title.')
p=write_case(c,d); add_mailto(p,'xoan.paz@example.com'); c.add('xoan.paz@example.com','EMAIL','hyperlink','Limpiar la relación externa mailto y el texto enlazado.'); c.add('Xoán Paz Loureiro','PERSONA','cabecera','Nombre que aparece en cabecera.')
c.add('45678901C','DNI','pie','DNI que aparece en pie.')
c.savejson()

# 06 Informe de rehabilitación tracked + image second alt
c=Case('06_informe_rehabilitacion','informe con control de cambios e imagen alternativa')
d=base_doc('Informe de rehabilitación','DNI 56789012D','DNI 56789012D')
rich_common(d,c,'Brais Varela Lamas','56789012D')
p=write_case(c,d); add_track(p,'Ana Ruiz Gil','Brais Varela Lamas','DNI 56789012D'); c.add('Ana Ruiz Gil','PERSONA','control_cambios_insertado','Vaciar autor del w:ins.'); c.add('Brais Varela Lamas','PERSONA','control_cambios_insertado','Conservar el texto insertado y anonimizarlo.'); c.add('56789012D','DNI','control_cambios_eliminado','Eliminar texto DNI retenido por track changes.'); c.savejson()

# 07 Convenio: metadata/custom + thumbnail 2
c=Case('07_convenio_urbanistico','convenio con metadatos, propiedad custom y miniatura')
d=base_doc('Convenio urbanístico','DNI 67890123E','DNI 67890123E')
rich_common(d,c,'Carme Soler Pujol','67890123E'); p=write_case(c,d); add_metadata(p,'Carme Soler Pujol','67890123E'); add_thumbnail(p,'CONVENIO\nCarme Soler Pujol\nDNI 67890123E')
c.add('Carme Soler Pujol','PERSONA','metadatos','Vaciar creator y lastModifiedBy.')
c.add('Bufete Rivera & Asociados','OTRO','metadatos','Vaciar Company.'); c.add('67890123E','DNI','custom','Anonimizar el DNI del campo Expediente en custom.xml.'); c.add('Carme Soler Pujol','PERSONA','miniatura','La miniatura legible debe eliminarse junto a la relación.'); c.add('67890123E','DNI','miniatura','La miniatura contiene DNI; eliminar el archivo de miniatura.'); c.savejson()

# 08 Dictamen: second comments + thumbnail
c=Case('08_dictamen_pericial','dictamen con segundo comentario y segunda miniatura')
d=base_doc('Dictamen pericial','DNI 78901234F','Perito: Noa Iglesias Freire')
rich_common(d,c,'Noa Iglesias Freire','78901234F'); p=write_case(c,d); add_comment(p,'Xurxo Méndez','El móvil de contacto es +34 633 555 666.')
c.add('Xurxo Méndez','PERSONA','comentario','El autor del comentario debe quedar vacío.'); c.add('+34 633 555 666','TELEFONO','comentario','El teléfono del cuerpo del comentario debe limpiarse.'); c.savejson()

# 09 Acta bilingue repeated spaced/unspaced uppercase forms
c=Case('09_acta_bilingue_variantes','acta bilingüe con variantes del mismo identificador')
d=base_doc('Acta bilingüe de comparecencia','DNI 11223344Z','DNI 11 223 344 z')
rich_common(d,c,'Núria Mas Riera','11223344Z')
ptext(d,'Identificación alternativa: 11 223 344 z · 11223344Z · 11223344z.'); ptext(d,'Identificació: Núria Mas Riera compareix davant la secretaria.',lang='ca-ES')
for wh in ['cuerpo','tabla','pie']:
 c.add('11223344Z','DNI',wh,'El mismo DNI aparece sin espacios; el normalizador puede cubrirlo también con espacios/mayúsculas en otra ubicación.')
c.add('11 223 344 z','DNI','cuerpo','Variante con espacios y minúscula; detectar y anonimizar como el mismo dato.'); c.add('11223344z','DNI','cuerpo','Variante de capitalización del mismo dato.'); c.add('Núria Mas Riera','PERSONA','cuerpo'); c.fp('11 223 344','Fragmento numérico incompleto, deliberadamente separado del dígito de control.')
write_case(c,d)

# 10 45+ page performance doc
c=Case('10_informe_extenso_48_paginas','informe extenso para rendimiento')
d=base_doc('Informe anual de evaluación','DNI 99887766M','Página de prueba · teléfono +34 644 777 888')
for page in range(48):
 d.add_heading(f'Capítulo {page+1}: evaluación de expedientes',level=1)
 for j in range(8): d.add_paragraph(f'Página lógica {page+1}, párrafo {j+1}. El equipo ficticio de análisis revisa los documentos, conserva el historial y registra las conclusiones para la unidad administrativa. Identificador de muestra: Laura Pereira Souto, DNI 99887766M. '+('Este texto se repite para crear una carga de lectura realista. '*3))
 if page<47: d.add_page_break()
c.add('Laura Pereira Souto','PERSONA'); c.add('99887766M','DNI'); c.add('+34 644 777 888','TELEFONO','pie'); write_case(c,d)

# 11 zip malformed and 12 missing main document
c=Case('11_corrupto','DOCX corrupto con archivo ZIP truncado'); (OUT/(c.stem+'.docx')).write_bytes(b'PK\x03\x04\x14\x00\x00\x00\x08\x00broken'); c.savejson()
c=Case('12_sin_document_xml','DOCX ZIP válido sin word/document.xml')
with ZipFile(OUT/(c.stem+'.docx'),'w',ZIP_DEFLATED) as z: z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'); z.writestr('word/styles.xml','<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')
c.savejson()

img.unlink(missing_ok=True)
# python-docx's base template ships a generic thumbnail; retain thumbnails only in deliberate cases.
for f in OUT.glob('*.docx'):
 if f.stem in {'01_contrato_marco','07_convenio_urbanistico'}: continue
 try:
  with ZipFile(f,'r') as zin: files={n:zin.read(n) for n in zin.namelist()}
  rel=etree.fromstring(files['_rels/.rels'])
  for old in list(rel):
   if (old.get('Type') or '').endswith('/thumbnail'): rel.remove(old)
  files['_rels/.rels']=etree.tostring(rel,xml_declaration=True,encoding='UTF-8',standalone=True)
  files.pop('docProps/thumbnail.jpeg',None)
  tmp=f.with_suffix('.tmp')
  with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
   for n,b in files.items(): z.writestr(n,b)
  tmp.replace(f)
 except Exception: pass
print('Generated',len(list(OUT.glob('*.docx'))),'DOCX files and',len(list(OUT.glob('*.esperado.json'))),'expected JSON files')
