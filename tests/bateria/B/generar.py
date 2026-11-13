from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, A3, A5, letter
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Table, TableStyle
from reportlab.lib import colors
from pypdf import PdfReader, PdfWriter
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import io, json, os, random, math

ROOT=str(__import__('pathlib').Path(__file__).resolve().parent)  # genera los PDF junto a este script
for d in ('texto','escaneo','dificil'): os.makedirs(os.path.join(ROOT,d),exist_ok=True)
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
pdfmetrics.registerFont(TTFont('DejaVu',FONT)); pdfmetrics.registerFont(TTFont('DejaVu-Bold',BOLD))
random.seed(52731)

def item(text, tipo, pagina=1, ubicacion='cuerpo', dificultad='media', nota=''):
    return {'texto':text,'tipo':tipo,'pagina':pagina,'ubicacion':ubicacion,'debe_detectarse':True,'dificultad':dificultad,'nota':nota}
def sidecar(folder, name, pages, tipo, datos, fps=None):
    path=os.path.join(ROOT,folder,name+'.pdf.esperado.json')
    with open(path,'w',encoding='utf8') as f: json.dump({'documento':name+'.pdf','paginas':pages,'tipo':tipo,'datos':datos,'falsos_positivos':fps or []},f,ensure_ascii=False,indent=2)
def make_pdf(folder,name,pagesize=A4):
    path=os.path.join(ROOT,folder,name+'.pdf'); return path,canvas.Canvas(path,pagesize=pagesize)
def header(c,page,title='EXPEDIENTE ADMINISTRATIVO'):
    w,h=c._pagesize; c.setFont('DejaVu-Bold',8); c.setFillColor(HexColor('#43536b')); c.drawString(42,h-30,title)
    c.setStrokeColor(HexColor('#98a2ad')); c.line(42,h-37,w-42,h-37)
    c.setFont('DejaVu',7); c.setFillColor(black); c.drawString(42,24,'Titular: Lucía Fernández Ríos · DNI 48276135M')
    c.drawRightString(w-42,24,f'Página {page} · Registro 2024/01842')
def paragraph(c, y, lines, x=52, size=9, leading=14):
    c.setFont('DejaVu',size)
    for line in lines: c.drawString(x,y,line); y-=leading
    return y

def stamp_image():
    im=Image.new('RGBA',(340,120),(255,255,255,0)); d=ImageDraw.Draw(im)
    d.ellipse((12,12,328,108),outline=(160,30,30,230),width=5)
    f=ImageFont.truetype(BOLD,28); d.text((36,29),'FIRMA: ELENA VIDAL',font=f,fill=(150,25,25,255))
    d.text((89,68),'DNI 19384756R',font=ImageFont.truetype(FONT,20),fill=(150,25,25,255))
    return im

def text_docs():
    entries=[]
    # 1 multi-page case file, repetitive personal footer, various locations
    name='01_expediente_mult pagina'.replace(' ','_'); p,c=make_pdf('texto',name)
    vals=[('Elena Vidal Moreno','PERSONA','cabecera'),('19384756R','DNI','cuerpo'),('C/ Olmo 17, 3.º B, 28014 Madrid','DIRECCION','cuerpo'),('elena.vidal@example.es','EMAIL','tabla'),('+34 612 345 789','TELEFONO','cuerpo'),('ES9121000418450200051332','IBAN','tabla')]
    for pg in range(1,4):
        header(c,pg,'EXPEDIENTE · SERVICIOS SOCIALES'); y=paragraph(c,755,[f'Expediente de atención y valoración — folio {pg}', 'Interesada: Elena Vidal Moreno · DNI 19384756R','Domicilio declarado: C/ Olmo 17, 3.º B, 28014 Madrid','Correo de contacto: elena.vidal@example.es'])
        if pg==1:
            y=paragraph(c,680,['En fecha 14/02/2024 se inicia la valoración solicitada por la interesada.','Teléfono de contacto: +34 612 345 789. El consentimiento consta en autos.'])
        elif pg==2:
            t=Table([['Concepto','Titular','Cuenta de abono'],['Prestación','Elena Vidal Moreno','ES9121000418450200051332']],colWidths=[100,160,225]); t.setStyle(TableStyle([('GRID',(0,0),(-1,-1),.5,colors.grey),('FONTNAME',(0,0),(-1,-1),'DejaVu'),('FONTSIZE',(0,0),(-1,-1),8)])); t.wrapOn(c,500,100); t.drawOn(c,52,610)
        else: paragraph(c,650,['Se incorpora informe social y se remite copia a la unidad competente.','Nota 1: La valoración provisional no constituye resolución definitiva.'])
        c.showPage()
    c.save(); entries=[item(v,t,2 if t=='IBAN' else 1,u,'media','Repetido en varias páginas.' if t=='PERSONA' else '') for v,t,u in vals]; entries += [item('Lucía Fernández Ríos','PERSONA',1,'pie','alta','Dato personal solo en el pie, repetido en todas las páginas.'),item('48276135M','DNI',1,'pie','alta','Dato personal solo en el pie, repetido en todas las páginas.')]
    sidecar('texto',name,3,'texto',entries,[{'texto':'2024/01842','motivo':'Referencia de expediente, no DNI.'}])

    # 2 deed style
    name='02_escritura_compraventa'; p,c=make_pdf('texto',name); header(c,1,'NOTARÍA · ESCRITURA PÚBLICA'); paragraph(c,750,['ESCRITURA DE COMPRAVENTA Y SUBROGACIÓN','Comparecen: D. Mateo Ruiz Calvo, DNI 51827364P, y Dña. Inés','Serrano Gil, NIE X4827163T, ambos mayores de edad.','Domicilio de la parte vendedora: Av. del Parque 81, 2.º A, 50008 Zaragoza.','La parte compradora declara CIF B76543218, sociedad Arce Norte, S.L.','Precio: 214.500,00 euros. Cuenta de origen: ES7921000813610123456789.','Se incorpora nota simple registral y justificante de transferencia.'])
    c.save(); sidecar('texto',name,1,'texto',[item('Mateo Ruiz Calvo','PERSONA'),item('51827364P','DNI'),item('Inés Serrano Gil','PERSONA'),item('X4827163T','NIE'),item('Av. del Parque 81, 2.º A, 50008 Zaragoza','DIRECCION'),item('B76543218','CIF'),item('ES7921000813610123456789','IBAN')])

    # 3 judgment
    name='03_sentencia_juzgado'; p,c=make_pdf('texto',name)
    for pg in range(1,3):
        header(c,pg,'JUZGADO DE PRIMERA INSTANCIA Nº 6'); paragraph(c,750,[f'SENTENCIA · procedimiento ordinario 311/2023 · página {pg}','Demandante: Adrián López Castaño (DNI 23918475S).','Demandada: Mar Azul Logística, S.L. (CIF B12876543).'])
        paragraph(c,675,['ANTECEDENTES DE HECHO','Primero. La parte actora reclama daños por incumplimiento contractual.','Segundo. Se aportan facturas, comunicaciones y justificante bancario.'] if pg==1 else ['FALLO','Se estima parcialmente la demanda y se condena al pago de 1.280,50 euros.','Notifíquese a las partes en C/ Mayor 6, 1.º, 33003 Oviedo.','Recurso dentro del plazo legal.'])
        c.showPage()
    c.save(); sidecar('texto',name,2,'texto',[item('Adrián López Castaño','PERSONA'),item('23918475S','DNI'),item('B12876543','CIF'),item('C/ Mayor 6, 1.º, 33003 Oviedo','DIRECCION',2)])

    # 4 invoice table
    name='04_factura_tabular'; p,c=make_pdf('texto',name); header(c,1,'FACTURA · SUMINISTROS DEL EBRO S.L.'); paragraph(c,750,['Factura F-2024-00981 · Fecha 08/05/2024','Cliente: Talleres Nerea S.C. · CIF J50192837','Contacto: nerea.taller@example.org · +34 976 201 884','Dirección: Polígono Río Huerva, nave 14, 50410 Cuarte de Huerva'])
    t=Table([['Unidades','Descripción','Base','IVA','Total'],['2','Revisión anual','180,00','37,80','217,80'],['1','Filtro industrial','42,50','8,93','51,43'],['','','222,50','46,73','269,23']],colWidths=[60,205,70,65,80]); t.setStyle(TableStyle([('GRID',(0,0),(-1,-1),.6,colors.grey),('FONTNAME',(0,0),(-1,-1),'DejaVu'),('FONTSIZE',(0,0),(-1,-1),8),('BACKGROUND',(0,0),(-1,0),colors.lightgrey)])); t.wrapOn(c,480,120); t.drawOn(c,52,570); paragraph(c,530,['IBAN para pago: ES3521000456780200051332','Referencia pedido: ORD-2024-005812'])
    c.save(); sidecar('texto',name,1,'texto',[item('J50192837','CIF',1,'cuerpo'),item('nerea.taller@example.org','EMAIL',1,'cuerpo'),item('+34 976 201 884','TELEFONO',1,'cuerpo'),item('Polígono Río Huerva, nave 14, 50410 Cuarte de Huerva','DIRECCION',1,'cuerpo'),item('ES3521000456780200051332','IBAN',1,'cuerpo'),item('ORD-2024-005812','REFERENCIA',1,'tabla')],[{'texto':'F-2024-00981','motivo':'Número de factura, referencia y no identificador personal.'}])

    # 5 form
    name='05_formulario_campos'; p,c=make_pdf('texto',name); header(c,1,'SOLICITUD DE AYUDA · FORMULARIO');
    y=750
    for k,v in [('Nombre y apellidos','Sara Benítez León'),('DNI','34782916L'),('Nº Seguridad Social','28/1234567890'),('Teléfono','+34 699 410 208'),('Correo','sara.benitez@example.net'),('Domicilio','C/ Fuente 9, bajo, 06002 Badajoz'),('Cuenta IBAN','ES6621000498761234567891')]:
        c.setFont('DejaVu-Bold',9); c.drawString(55,y,k+':'); c.setFont('DejaVu',9); c.drawString(205,y,v); c.setStrokeColor(HexColor('#bbbbbb')); c.line(205,y-4,540,y-4); y-=43
    c.save(); sidecar('texto',name,1,'texto',[item('Sara Benítez León','PERSONA',1,'cuerpo'),item('34782916L','DNI',1,'cuerpo'),item('28/1234567890','NSS',1,'cuerpo'),item('+34 699 410 208','TELEFONO',1,'cuerpo'),item('sara.benitez@example.net','EMAIL',1,'cuerpo'),item('C/ Fuente 9, bajo, 06002 Badajoz','DIRECCION',1,'cuerpo'),item('ES6621000498761234567891','IBAN',1,'cuerpo')])

    # 6 two columns
    name='06_dos_columnas'; p,c=make_pdf('texto',name); header(c,1,'INFORME DE VALORACIÓN');
    paragraph(c,750,['Solicitante: Hugo Martín Soler · DNI 40718293K'],52); c.setStrokeColor(HexColor('#999999')); c.line(300,150,300,740)
    paragraph(c,710,['DATOS DEL SOLICITANTE','Hugo Martín Soler','Email: hugo.martin@example.com','C/ Río Tajo 22, 4.º C','28045 Madrid'],52,8,18)
    paragraph(c,710,['DATOS ECONÓMICOS','Tel.: +34 611 208 477','IBAN: ES9121000418450200051298','Empresa: Lumen Digital S.L.','CIF B90345671'],318,8,18)
    c.save(); sidecar('texto',name,1,'texto',[item('Hugo Martín Soler','PERSONA'),item('40718293K','DNI'),item('hugo.martin@example.com','EMAIL'),item('C/ Río Tajo 22, 4.º C, 28045 Madrid','DIRECCION'),item('+34 611 208 477','TELEFONO'),item('ES9121000418450200051298','IBAN'),item('B90345671','CIF')])

    # 7 hyphenated line endings
    name='07_guiones_fin_linea'; p,c=make_pdf('texto',name); header(c,1,'INFORME DE INSPECCIÓN'); paragraph(c,750,['Persona interesada: Paula Núñez Ortega · DNI 28641957V','Durante la inspec-','ción se examinó el domi-','cilio en Pza. del Olmo 4, 1.º, 09003 Burgos.','La correspon-','dencia se remite a paula.nunez@example.es.','Teléfono de aviso: +34 947 210 776.'])
    c.save(); sidecar('texto',name,1,'texto',[item('Paula Núñez Ortega','PERSONA'),item('28641957V','DNI'),item('Pza. del Olmo 4, 1.º, 09003 Burgos','DIRECCION',1,'cuerpo','alta','La palabra anterior termina con guion de maquetación.'),item('paula.nunez@example.es','EMAIL'),item('+34 947 210 776','TELEFONO')],[{'texto':'inspec- ción','motivo':'Palabra partida por guion al final de línea, no dato personal.'}])

    # 8 split identifiers across line, text available as separate lines
    name='08_identificadores_partidos'; p,c=make_pdf('texto',name); header(c,1,'ANEXO DE IDENTIFICACIÓN'); paragraph(c,750,['Titular: Darío Campos Rey · DNI 73','184926','Cuenta beneficiaria: ES91 2100 0418 4502','0005 1332','Correo alternativo: d.campos@example.es'])
    c.save(); sidecar('texto',name,1,'texto',[item('Darío Campos Rey','PERSONA'),item('73184926','DNI',1,'cuerpo','alta','Identificador partido en dos líneas del PDF.'),item('ES9121000418450200051332','IBAN',1,'cuerpo','alta','IBAN segmentado entre dos líneas, con separadores visuales.'),item('d.campos@example.es','EMAIL')])

    # 9 footnotes
    name='09_notas_al_pie'; p,c=make_pdf('texto',name); header(c,1,'RESOLUCIÓN DE RECURSO'); paragraph(c,750,['Recurrente: Mónica Gil Paredes · DNI 25871469H','Domicilio a efectos de notificación: C/ Luna 31, 5.º, 15003 A Coruña','Se admite el recurso presentado el 19/03/2024.¹','La cuenta de devolución es ES6621000498761234567800.'])
    c.setFont('DejaVu',7); c.drawString(52,90,'¹ La recurrente, Mónica Gil Paredes, puede ser contactada en +34 981 204 561.')
    c.save(); sidecar('texto',name,1,'texto',[item('Mónica Gil Paredes','PERSONA'),item('25871469H','DNI'),item('C/ Luna 31, 5.º, 15003 A Coruña','DIRECCION'),item('ES6621000498761234567800','IBAN'),item('+34 981 204 561','TELEFONO',1,'cuerpo','alta','Dato personal en nota al pie, separado del texto principal.')])

    # 10 draw order deliberately not reading order
    name='10_orden_lectura_invertido'; p,c=make_pdf('texto',name)
    # paint body from bottom upwards; extraction follows content stream (bottom-to-top)
    c.setFont('DejaVu-Bold',12); c.drawString(52,780,'RESUMEN DE DATOS')
    for y,s in [(500,'Persona: Bruno Salas Marín · DNI 48269017J'),(450,'Domicilio: C/ Alba 2, 1.º, 26001 Logroño'),(400,'Correo: bruno.salas@example.org'),(350,'IBAN: ES0721000813610123456701')]:
        c.setFont('DejaVu',10); c.drawString(52,y,s)
    c.save(); sidecar('texto',name,1,'texto',[item('Bruno Salas Marín','PERSONA'),item('48269017J','DNI'),item('C/ Alba 2, 1.º, 26001 Logroño','DIRECCION'),item('bruno.salas@example.org','EMAIL'),item('ES0721000813610123456701','IBAN')])

    # 11 scan-like embedded identity card image (copyable nearby text)
    name='11_imagen_embebida_sello'; p,c=make_pdf('texto',name); header(c,1,'DOCUMENTACIÓN APORTADA'); paragraph(c,750,['Declarante: Elena Vidal Moreno · DNI 19384756R','El sello inserto contiene texto en imagen y no tiene capa OCR:'])
    c.drawImage(ImageReader(stamp_image()),70,550,width=340,height=120,mask='auto'); paragraph(c,520,['Texto esperado en la imagen: FIRMA: ELENA VIDAL; DNI 19384756R.'])
    c.save(); sidecar('texto',name,1,'texto',[item('Elena Vidal Moreno','PERSONA',1,'cuerpo'),item('19384756R','DNI',1,'cuerpo'),item('FIRMA: ELENA VIDAL','PERSONA',1,'imagen','alta','Texto solo en una imagen incrustada; el lector PDF documenta que no inspecciona imágenes.'),item('19384756R','DNI',1,'imagen','alta','Repetido solo dentro del sello raster; no esperable desde extracción de texto.')])

    # 12 embedded signature photo / ID
    name='12_imagen_embebida_firma'; p,c=make_pdf('texto',name); header(c,1,'ANEXO · CONSENTIMIENTO'); paragraph(c,750,['Autorización firmada por Inés Serrano Gil · NIE X4827163T','La fotografía de firma incluye datos escritos manualmente.'])
    im=Image.new('RGB',(620,170),(248,246,230)); d=ImageDraw.Draw(im); d.rectangle((3,3,616,166),outline=(80,80,80),width=3); d.text((22,20),'RECIBÍ: 14/06/2024',font=ImageFont.truetype(BOLD,26),fill=(20,30,80)); d.text((22,75),'IBAN ES79 2100 0813 6101 2345 6789',font=ImageFont.truetype(FONT,23),fill=(20,30,80)); d.text((22,120),'Inés S. Gil',font=ImageFont.truetype(FONT,27),fill=(20,30,80)); c.drawImage(ImageReader(im),54,530,width=500,height=137)
    c.save(); sidecar('texto',name,1,'texto',[item('Inés Serrano Gil','PERSONA'),item('X4827163T','NIE'),item('RECIBÍ: 14/06/2024','OTRO',1,'imagen','alta','Texto dentro de foto incrustada; sin texto PDF seleccionable.'),item('ES7921000813610123456789','IBAN',1,'imagen','alta','IBAN aparece solo en la fotografía rasterizada.'),item('Inés S. Gil','PERSONA',1,'imagen','alta','Firma manuscrita simulada como imagen.')])

    # 13 certificate, still >=12 copyable (forms / two columns etc.)
    name='13_certificado_laboral'; p,c=make_pdf('texto',name); header(c,1,'CERTIFICADO DE EMPRESA'); paragraph(c,750,['Certificamos que Dña. Aitana Pardo Ruiz, DNI 43981726D,','presta servicios en Nube Clara Tecnología S.L. (CIF B61820495).','Domicilio: Av. Europa 42, planta 3, 28108 Alcobendas.','Correo profesional: aitana.pardo@example.com · +34 910 213 645','Referencia interna: RRHH/2024/1830'])
    c.save(); sidecar('texto',name,1,'texto',[item('Aitana Pardo Ruiz','PERSONA'),item('43981726D','DNI'),item('B61820495','CIF'),item('Av. Europa 42, planta 3, 28108 Alcobendas','DIRECCION'),item('aitana.pardo@example.com','EMAIL'),item('+34 910 213 645','TELEFONO'),item('RRHH/2024/1830','REFERENCIA')])

    # 14 rental contract
    name='14_contrato_arrendamiento'; p,c=make_pdf('texto',name); header(c,1,'CONTRATO DE ARRENDAMIENTO'); paragraph(c,750,['Arrendadora: Carmen Ríos Valera · DNI 16593827C.','Arrendatario: Joel Martín Sanz · NIE Y2184736F.','Inmueble: C/ San Pedro 18, 2.º D, 41001 Sevilla.','Renta mensual: 875,00 €. Pago en ES6621000498761234567818.','Contacto arrendatario: joel.martin@example.es · +34 622 304 119.'])
    c.save(); sidecar('texto',name,1,'texto',[item('Carmen Ríos Valera','PERSONA'),item('16593827C','DNI'),item('Joel Martín Sanz','PERSONA'),item('Y2184736F','NIE'),item('C/ San Pedro 18, 2.º D, 41001 Sevilla','DIRECCION'),item('ES6621000498761234567818','IBAN'),item('joel.martin@example.es','EMAIL'),item('+34 622 304 119','TELEFONO')])

def render_scan_page(text_lines,dpi,seed,rotation=0,low=False,blur=False,jpeg=False,shadow=False,fold=False,stain=False):
    rng=random.Random(seed); w=round(8.27*dpi); h=round(11.69*dpi)
    im=Image.new('RGB',(w,h),(247,245,236)); d=ImageDraw.Draw(im)
    font=ImageFont.truetype(FONT,max(10,round(dpi*.10))); bold=ImageFont.truetype(BOLD,max(10,round(dpi*.105)))
    # Light paper edges and occasional lines
    margin=round(dpi*.47); y=round(dpi*.75)
    d.text((margin,y),'DIRECCIÓN PROVINCIAL · DOCUMENTACIÓN',font=bold,fill=(55,61,67)); y+=round(dpi*.25); d.line((margin,y,w-margin,y),fill=(130,130,125),width=max(1,dpi//150)); y+=round(dpi*.3)
    for i,line in enumerate(text_lines):
        f=bold if line.startswith(('DNI','IBAN','Fecha','Teléfono','Correo','Titular','NSS')) else font
        d.text((margin,y),line,font=f,fill=(30,32,34)); y+=round(dpi*.24)
        if i in (2,6): y+=round(dpi*.12)
    # paper texture / folds / stains before rotation
    if shadow:
        shade=Image.new('L',im.size,0); sd=ImageDraw.Draw(shade); sd.polygon([(0,0),(int(w*.12),0),(int(w*.05),h),(0,h)],fill=52); shade=shade.filter(ImageFilter.GaussianBlur(dpi*.08)); im=Image.composite(Image.new('RGB',im.size,(65,55,45)),im,shade)
    if fold:
        ov=Image.new('RGBA',im.size,(0,0,0,0)); od=ImageDraw.Draw(ov); od.line((w*.47,0,w*.49,h),fill=(120,110,90,35),width=max(2,dpi//45)); im=Image.alpha_composite(im.convert('RGBA'),ov).convert('RGB')
    if stain:
        sd=ImageDraw.Draw(im); sd.ellipse((w*.75,h*.18,w*.79,h*.22),fill=(174,145,102)); sd.ellipse((w*.77,h*.20,w*.805,h*.23),fill=(186,157,115))
    if low: im=ImageEnhance.Contrast(im).enhance(.55)
    if blur: im=im.filter(ImageFilter.GaussianBlur(max(.4,dpi/300)))
    # subtle sensor noise
    pix=im.load(); n=max(0,round(w*h*.00035));
    for _ in range(n):
        x=rng.randrange(w); yy=rng.randrange(h); old=pix[x,yy]; delta=rng.choice([-18,-12,10,14]); pix[x,yy]=tuple(max(0,min(255,v+delta)) for v in old)
    if rotation: im=im.rotate(rotation,expand=False,resample=Image.Resampling.BICUBIC,fillcolor=(232,229,220))
    if jpeg:
        bio=io.BytesIO(); im.save(bio,format='JPEG',quality=23,optimize=True); bio.seek(0); im=Image.open(bio).convert('RGB')
    return im

def scanned_docs():
    # 8 image-only PDFs, including two nine-page timing samples.
    specs=[
    ('S01_formulario_rotado_150',150,1,1.7,False,True,False,False,False,False,["Titular: Nora Salcedo Vega","DNI 53817426A","Fecha de solicitud: 17/03/2024","Teléfono: +34 633 204 817","Correo: nora.salcedo@example.es","Domicilio: C/ Prado 8, 1.º, 09004 Burgos"]),
    ('S02_carta_bajo_contraste_200',200,1,-2.3,True,True,False,False,False,False,["A la atención de: Iván Costa Paredes","NIE X7391826R","IBAN ES91 2100 0418 4502 0005 1332","Fecha: 02/11/2023","Contacto: ivan.costa@example.org"]),
    ('S03_factura_jpeg_fuerte_150',150,1,0.6,False,False,True,False,False,False,["FACTURA 2024/7781 · Fecha: 08/05/2024","Cliente: Maderas Litoral S.L. CIF B28471936","Correo: pedidos@example.com","Teléfono: +34 965 201 683","IBAN: ES66 2100 0498 7612 3456 7891"]),
    ('S04_documento_sombra_pliegue_200',200,1,-1.2,False,False,False,True,True,False,["DECLARACIÓN RESPONSABLE","Persona: Raúl Nieto Campos · DNI 41829376W","NSS: 28/8493027615","Dirección: Av. del Mar 112, 03008 Alicante","Fecha: 19/06/2024"]),
    ('S05_carta_mancha_150',150,1,2.6,True,False,False,False,False,True,["Destinataria: Vega Prieto Luna","DNI 29184736E","Teléfono: +34 971 203 548","Correo: v.prieto@example.net","Cuenta: ES35 2100 0456 7802 0005 1332"]),
    ('S06_recibo_mixto_200',200,1,-0.8,False,True,False,False,True,True,["RECIBO DE ARRENDAMIENTO","Arrendatario: Lucas Ferrer Solà","NIE Y4827193P","C/ Oliva 27, 3.º, 07003 Palma","IBAN ES07 2100 0813 6101 2345 6701","Fecha 30/09/2024 · Teléfono +34 644 218 907"]),
    ('S07_lote_9pag_150',150,9,1.1,False,False,False,False,False,False,None),
    ('S08_lote_9pag_200',200,9,-1.9,True,True,True,True,False,False,None),]
    for ix,(name,dpi,np,rot,low,blur,jpeg,shadow,fold,stain,lines) in enumerate(specs):
        imgs=[]; all_data=[]
        for pg in range(1,np+1):
            if lines is None:
                persona=['Marina Roldán Gil','Óscar Pons Vidal','Leire Acosta Navas','Tomás Vidal Roca','Aroa Serra León','Nicolás Gil Moya','Elsa Calvo Rius','Pau Ríos Mateo','Clara Benet Soler'][(pg-1+ix)%9]
                dni=['40918273F','23847196M','51829374D','18746392Q','32718465K','46271938S','29184736B','17382946R','38472619T'][(pg-1+ix)%9]
                mail=['m.roldan@example.es','o.pons@example.org','leire.acosta@example.net','t.vidal@example.com','aroa.serra@example.es','n.gil@example.org','elsa.calvo@example.net','pau.rios@example.com','clara.benet@example.es'][(pg-1+ix)%9]
                tel=f'+34 6{(pg+ix)%10}2 314 80{pg%10}'
                iban=f'ES{(pg%90)+10} 2100 0418 4502 0005 {1300+pg}'
                lines_pg=[f'FORMULARIO DE REGISTRO · HOJA {pg}',f'Titular: {persona}',f'DNI {dni}',f'Fecha de nacimiento: 0{(pg%8)+1}/0{(pg%9)+1}/198{pg%10}',f'Teléfono: {tel}',f'Correo: {mail}',f'IBAN {iban}','Expediente archivado para tramitación.']
                all_data += [item(persona,'PERSONA',pg,'cuerpo','media','OCR en página de lote.'),item(dni,'DNI',pg,'cuerpo','alta','Impreso pequeño en muestra de nueve páginas.'),item('01/01/198'+str(pg%10),'OTRO',pg,'cuerpo','media','Fecha manuscrita tipografiada; salida OCR debe conservar forma.'),item(tel,'TELEFONO',pg,'cuerpo','alta'),item(mail,'EMAIL',pg,'cuerpo','media'),item(iban.replace(' ',''),'IBAN',pg,'cuerpo','alta','Espacios de impresión entre grupos.')]
            else:
                lines_pg=lines
                if pg==1:
                    # annotate all obvious PII occurrences
                    for ln in lines:
                        date_match=__import__('re').search(r'Fecha(?: de solicitud)?:?\s*(\d{2}/\d{2}/\d{4})',ln)
                        if date_match: all_data.append(item(date_match.group(1),'OTRO',pg,'cuerpo','media','Fecha impresa en la imagen escaneada.'))
                        if ln.startswith('A la atención de: '): all_data.append(item(ln.split('A la atención de: ',1)[1],'PERSONA',pg,'cuerpo','media','Nombre en el destinatario de la carta escaneada.'))
                        if 'DNI ' in ln: all_data.append(item(ln.split('DNI ')[1],'DNI',pg,'cuerpo','alta','OCR en página escaneada.'))
                        if 'NIE ' in ln: all_data.append(item(ln.split('NIE ')[1],'NIE',pg,'cuerpo','alta','OCR en página escaneada.'))
                        if 'IBAN ' in ln: all_data.append(item(ln.split('IBAN ')[1].replace(' ',''),'IBAN',pg,'cuerpo','alta','IBAN con espacios entre grupos en la imagen.'))
                        if 'Cuenta: ' in ln: all_data.append(item(ln.split('Cuenta: ')[1].replace(' ',''),'IBAN',pg,'cuerpo','alta','IBAN con espacios entre grupos en la imagen.'))
                        if 'Teléfono: ' in ln: all_data.append(item(ln.split('Teléfono: ')[1],'TELEFONO',pg,'cuerpo','alta'))
                        if 'Contacto: ' in ln and '@' in ln: all_data.append(item(ln.split('Contacto: ')[1],'EMAIL',pg,'cuerpo','media'))
                        if 'Correo: ' in ln: all_data.append(item(ln.split('Correo: ')[1],'EMAIL',pg,'cuerpo','media'))
                        if 'Persona: ' in ln: all_data.append(item(ln.split('Persona: ')[1].split(' ·')[0],'PERSONA',pg,'cuerpo','media'))
                        if 'Destinataria: ' in ln: all_data.append(item(ln.split('Destinataria: ')[1],'PERSONA',pg,'cuerpo','media'))
                        if 'Titular: ' in ln: all_data.append(item(ln.split('Titular: ')[1],'PERSONA',pg,'cuerpo','media'))
                        if 'Arrendatario: ' in ln: all_data.append(item(ln.split('Arrendatario: ')[1],'PERSONA',pg,'cuerpo','media'))
                        if 'NSS: ' in ln: all_data.append(item(ln.split('NSS: ')[1],'NSS',pg,'cuerpo','alta'))
                        if 'CIF ' in ln: all_data.append(item(ln.split('CIF ')[1],'CIF',pg,'cuerpo','alta'))
                        if 'Domicilio: ' in ln: all_data.append(item(ln.split('Domicilio: ')[1],'DIRECCION',pg,'cuerpo','alta'))
                        if ln.startswith('C/ '): all_data.append(item(ln,'DIRECCION',pg,'cuerpo','alta'))
                        if ln.startswith('Av. '): all_data.append(item(ln.split('Dirección: ')[-1],'DIRECCION',pg,'cuerpo','alta'))
            im=render_scan_page(lines_pg,dpi,ix*100+pg,rot if pg==1 else 0,low,blur,jpeg,shadow,fold,stain); imgs.append(im)
        path=os.path.join(ROOT,'escaneo',name+'.pdf'); imgs[0].save(path,'PDF',resolution=dpi,save_all=True,append_images=imgs[1:])
        sidecar('escaneo',name,np,'escaneo',all_data,[{'texto':'FORMULARIO','motivo':'Rótulo genérico, no dato personal.'}])

def difficult_docs():
    # encrypted inaccessible PDF
    name='D01_cifrado_sin_clave'; path,c=make_pdf('dificil',name); c.drawString(50,750,'Titular: Julia Pardo · DNI 18374629G'); c.save(); writer=PdfWriter();
    for pg in PdfReader(path).pages: writer.add_page(pg)
    writer.encrypt('clave-interna-no-proporcionada-72');
    with open(path,'wb') as f: writer.write(f)
    sidecar('dificil',name,1,'dificil',[item('Julia Pardo','PERSONA',1,'cuerpo','alta','PDF cifrado; sin contraseña proporcionada al sistema.'),item('18374629G','DNI',1,'cuerpo','alta','PDF cifrado; sin contraseña proporcionada al sistema.')])
    # truncated PDF
    name='D02_danado_truncado'; path,c=make_pdf('dificil',name); c.drawString(50,750,'Titular: Mario Roca · DNI 47382916N'); c.save(); data=open(path,'rb').read(); open(path,'wb').write(data[:len(data)//2]); sidecar('dificil',name,1,'dificil',[item('Mario Roca','PERSONA',1,'cuerpo','alta','Dato está en el prefijo válido; archivo truncado antes del cierre.'),item('47382916N','DNI',1,'cuerpo','alta','Dato está en el prefijo válido; archivo truncado antes del cierre.')])
    # zero pages
    name='D03_cero_paginas'; path=os.path.join(ROOT,'dificil',name+'.pdf'); w=PdfWriter(); open(path,'wb').write(b'')
    with open(path,'wb') as f: w.write(f)
    sidecar('dificil',name,0,'dificil',[])
    # mixed A3 A5 sizes
    name='D04_tamanos_A3_A5'; path=os.path.join(ROOT,'dificil',name+'.pdf'); c=canvas.Canvas(path,pagesize=A3); c.setFont('DejaVu',16); c.drawString(70,1100,'A3 · Titular: Eva Luna Rey · DNI 30918472C'); c.showPage(); c.setPageSize(A5); c.drawString(30,560,'A5 · IBAN ES6621000498761234567891'); c.save(); sidecar('dificil',name,2,'dificil',[item('Eva Luna Rey','PERSONA',1),item('30918472C','DNI',1),item('ES6621000498761234567891','IBAN',2)])
    # white-on-white extractable
    name='D05_texto_blanco_oculto'; path,c=make_pdf('dificil',name); c.setFillColor(white); c.setFont('DejaVu',12); c.drawString(70,720,'DATO OCULTO: Sergio Alba Nieto · DNI 48172639Q · correo sergio.alba@example.es'); c.setFillColor(black); c.drawString(50,760,'Documento de trámite sin identificación visible.'); c.save(); sidecar('dificil',name,1,'dificil',[item('Sergio Alba Nieto','PERSONA',1,'oculto','alta','Texto blanco sobre blanco; seleccionable y extraíble.'),item('48172639Q','DNI',1,'oculto','alta','Texto blanco sobre blanco; seleccionable y extraíble.'),item('sergio.alba@example.es','EMAIL',1,'oculto','alta','Texto blanco sobre blanco; seleccionable y extraíble.')])
    # annotation/comment
    name='D06_anotacion_comentario'; path,c=make_pdf('dificil',name); c.drawString(50,750,'Informe técnico de inspección · sin datos en el cuerpo.'); c.save(); r=PdfReader(path); w=PdfWriter(); w.append_pages_from_reader(r); w.add_annotation(page_number=0,annotation={'/Type':'/Annot','/Subtype':'/Text','/Rect':[72,650,92,670],'/Contents':'DNI 52619483P; correo marta.lopez@example.es','/T':'Comentario de revisión','/Name':'Comment'});
    with open(path,'wb') as f:w.write(f)
    sidecar('dificil',name,1,'dificil',[item('52619483P','DNI',1,'anotacion','alta','Dato en el contenido de una anotación/comentario PDF.'),item('marta.lopez@example.es','EMAIL',1,'anotacion','alta','Dato en el contenido de una anotación/comentario PDF.')])
    # metadata
    name='D07_metadatos_personales'; path,c=make_pdf('dificil',name); c.drawString(50,750,'Certificado sin información identificativa en el cuerpo.'); c.save(); r=PdfReader(path); w=PdfWriter(); w.append_pages_from_reader(r); w.add_metadata({'/Author':'Lucía Herrera Mena · DNI 27481936A','/Title':'Expediente de Lucía Herrera','/Subject':'Revisión de datos de contacto'});
    with open(path,'wb') as f:w.write(f)
    sidecar('dificil',name,1,'dificil',[item('Lucía Herrera Mena','PERSONA',1,'metadatos','alta','Campo Author del diccionario de metadatos.'),item('27481936A','DNI',1,'metadatos','alta','Campo Author del diccionario de metadatos.'),item('Lucía Herrera','PERSONA',1,'metadatos','media','Campo Title del diccionario de metadatos.')])

text_docs(); scanned_docs(); difficult_docs()
print('generation complete')
