/**
 * PoDriveStorage.gs — Private PO storage for the same school Apps Script project.
 *
 * ADD to the existing project. Do NOT add a second doPost(e).
 * The webhook file calls siscDriveUploadPo_ / siscDriveGetPoFile_.
 *
 * The webhook's shared secret is checked before these functions are called.
 * Never expose the secret in client-side code or public Sheet cells.
 * Uses PO_DRIVE_FOLDER_ID. New files are private/inherited from that folder.
 *
 * Stage 1 limit: 8 MiB per file for Apps Script JSON/base64 transport.
 * Larger files require a future Drive resumable-upload implementation.
 */

var SISC_PO_UPLOAD_LIMIT_ = 8 * 1024 * 1024;
var SISC_PO_ALLOWED_MIMES_ = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true
};

function siscDriveFolder_() {
  var id = String(PropertiesService.getScriptProperties()
    .getProperty('PO_DRIVE_FOLDER_ID') || '').trim();
  if (!/^[A-Za-z0-9_-]{15,150}$/.test(id)) {
    throw new Error('Configure an authorized PO_DRIVE_FOLDER_ID first.');
  }
  if (siscIsoCheckWorkbookVisibility_(id).anyoneCanRead) {
    throw new Error('The PO folder allows anyone-with-link access. Restrict sharing before storing confidential PO files.');
  }
  return DriveApp.getFolderById(id);
}

/**
 * Read-only folder privacy check. Run once from the Apps Script editor after
 * pasting PoDriveStorage.gs. No PO files are created, read, or modified.
 */
function siscDriveCheckFolderSetup() {
  var folder = siscDriveFolder_();
  var result = {
    ok: true,
    folderAccess: 'verified',
    folderPrivacy: 'no-anyone-link',
    uploadWritePermission: 'previously-verified-separately',
    automaticWebsiteUpload: 'not-enabled'
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function siscDriveAllowedFile_(file) {
  var mime = String(file.mimeType || '').toLowerCase();
  if (!SISC_PO_ALLOWED_MIMES_[mime]) {
    throw new Error('Only PDF, JPEG, PNG and WebP official PO files are permitted.');
  }
  return mime;
}

function siscDriveCheckMagic_(bytes, mime) {
  if (!bytes || !bytes.length) throw new Error('Empty PO file.');
  var u = function (n) { return (bytes[n] || 0) & 255; };
  if (mime === 'application/pdf') {
    if (u(0)!==37 || u(1)!==80 || u(2)!==68 || u(3)!==70 || u(4)!==45) {
      throw new Error('File contents do not match a PDF.');
    }
  } else if (mime === 'image/jpeg') {
    if (u(0)!==255 || u(1)!==216 || u(2)!==255) {
      throw new Error('File contents do not match a JPEG.');
    }
  } else if (mime === 'image/png') {
    if (u(0)!==137 || u(1)!==80 || u(2)!==78 || u(3)!==71) {
      throw new Error('File contents do not match a PNG.');
    }
  } else if (mime === 'image/webp') {
    var str = String.fromCharCode.apply(null, bytes.slice(0, 4).map(function(x) { return x & 255; }));
    var fmt = String.fromCharCode.apply(null, bytes.slice(8, 12).map(function(x) { return x & 255; }));
    if (str !== 'RIFF' || fmt !== 'WEBP') {
      throw new Error('File contents do not match a WebP.');
    }
  }
}

function siscDriveUploadPo_(request) {
  var upload = request && request.upload || {};
  var po = String(upload.poNumber || '').trim();
  var prf = String(upload.prfNumber || '').trim();
  var rawName = String(upload.name || '').trim();
  var mime = siscDriveAllowedFile_(upload);
  var encoded = String(upload.base64 || '');
  if (!po || po.length > 100 || !/^[\w\s#./-]+$/.test(po)) {
    throw new Error('A valid PO number is required.');
  }
  if (prf.length > 100) throw new Error('Invalid PRF number.');
  if (!encoded || encoded.length > Math.ceil(SISC_PO_UPLOAD_LIMIT_ * 4/3) + 50 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('PO file is missing, invalid or too large.');
  }
  var content = Utilities.base64Decode(encoded);
  if (content.length > SISC_PO_UPLOAD_LIMIT_) throw new Error('PO file exceeds 8 MiB limit.');
  siscDriveCheckMagic_(content, mime);

  // No public sharing and no new public link: files inherit the authorized
  // school folder's restrictions. Avoid path separators/control characters.
  var filename = rawName.replace(/[\\/\u0000-\u001f]/g, '_')
    .replace(/[^a-zA-Z0-9._() -]/g, '_').slice(0, 130);
  if (!filename) filename = 'official-po';
  var stamp = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyyMMdd-HHmmss');
  var safePo = po.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  var savedName = safePo + '-' + stamp + '-' + filename;
  var blob = Utilities.newBlob(content, mime, savedName);
  var file = siscDriveFolder_().createFile(blob);
  file.setDescription('Official PO ' + po + (prf ? ' | PRF ' + prf : '') +
    ' | Uploaded through authorized Supplier Evaluation staff endpoint.');

  return {
    ok: true,
    provider: 'google-drive',
    fileId: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    size: file.getSize()
  };
}

/**
 * Fetch only a file under the approved PO folder. This is called by a trusted
 * server endpoint after verifying staff identity, never directly from browser.
 */
function siscDriveGetPoFile_(request) {
  var fileId = String(request && request.fileId || '').trim();
  if (!/^[A-Za-z0-9_-]{15,150}$/.test(fileId)) throw new Error('Invalid PO file ID.');
  var approvedFolder = siscDriveFolder_();
  var file = DriveApp.getFileById(fileId);
  if (!siscWebhookFileInFolder_(file, approvedFolder.getId())) {
    throw new Error('File is outside the authorized Southville PO archive.');
  }
  var mime = siscDriveAllowedFile_({ mimeType: file.getMimeType() });
  if (file.getSize() > SISC_PO_UPLOAD_LIMIT_) {
    throw new Error('This file needs the large-file Drive preview integration.');
  }
  var bytes = file.getBlob().getBytes();
  siscDriveCheckMagic_(bytes, mime);
  return {
    ok: true,
    fileId: file.getId(),
    name: file.getName(),
    mimeType: mime,
    size: file.getSize(),
    base64: Utilities.base64Encode(bytes)
  };
}

/**
 * Bounded chunk transport. Each request remains below Vercel's 4.5MB
 * Function payload limit and is authenticated by the existing school
 * doPost(e) webhook. No Drive token reaches the browser.
 */
var SISC_PO_CHUNK_SIZE_ = 1024 * 1024;
var SISC_PO_STAGE_FOLDER_ = '_Supplier Evaluation Temporary PO Uploads';

function siscPoUploadId_(id) {
  var text=String(id||'');
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(text)){
    throw new Error('Invalid secure PO upload identifier.');
  }
  return text.toLowerCase();
}
function siscPoChunkMeta_(upload) {
  upload=upload||{};
  var id=siscPoUploadId_(upload.uploadId);
  var po=String(upload.poNumber||'').trim();
  var prf=String(upload.prfNumber||'').trim();
  var name=String(upload.name||'').trim();
  var mime=siscDriveAllowedFile_({mimeType:upload.mimeType});
  var total=Number(upload.totalBytes);
  var chunks=Number(upload.chunkCount);
  if(!po||po.length>100||!/^[\w\s#./-]+$/.test(po)||
    prf.length>100||!name||name.length>160||
    !Number.isInteger(total)||total<1||total>SISC_PO_UPLOAD_LIMIT_||
    !Number.isInteger(chunks)||chunks!==Math.ceil(total/SISC_PO_CHUNK_SIZE_)||
    chunks<1||chunks>8)throw new Error('Invalid bounded PO upload metadata.');
  var cleanName=name.replace(/[\\/\u0000-\u001f]/g,'_')
    .replace(/[^a-zA-Z0-9._() -]/g,'_').slice(0,120);
  var poName=po.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,80);
  return {uploadId:id,po:po,prf:prf,name:cleanName,mime:mime,
    totalBytes:total,chunkCount:chunks,
    finalName:poName+'--'+id+'--'+cleanName};
}
function siscPoStagingFolder_() {
  var parent=siscDriveFolder_();
  var folders=parent.getFoldersByName(SISC_PO_STAGE_FOLDER_);
  return folders.hasNext()?folders.next():parent.createFolder(SISC_PO_STAGE_FOLDER_);
}
function siscPoStageName_(id,index){
  return 'se-upload-'+id+'-part-'+index;
}
function siscPoStoredResult_(file) {
  return {ok:true,provider:'google-drive',fileId:file.getId(),
    name:file.getName(),mimeType:file.getMimeType(),size:file.getSize()};
}

/** An idempotent 1 MiB chunk saved in the private temporary Drive folder. */
function siscDriveUploadChunk_(request) {
  var upload=(request&&request.upload)||{};
  var info=siscPoChunkMeta_(upload);
  var index=Number(upload.chunkIndex);
  if(!Number.isInteger(index)||index<0||index>=info.chunkCount){
    throw new Error('Invalid PO chunk position.');
  }
  var encoded=String(upload.base64||'');
  if(!encoded||encoded.length>Math.ceil(SISC_PO_CHUNK_SIZE_*4/3)+20||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)){
    throw new Error('Invalid PO chunk contents.');
  }
  var bytes=Utilities.base64Decode(encoded);
  var expected=Math.min(SISC_PO_CHUNK_SIZE_,
    info.totalBytes-index*SISC_PO_CHUNK_SIZE_);
  if(bytes.length!==expected)throw new Error('PO chunk has an invalid length.');
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(25000))throw new Error('PO archive is busy. Retry this chunk.');
  try{
    var stage=siscPoStagingFolder_();
    var chunkName=siscPoStageName_(info.uploadId,index);
    var existing=stage.getFilesByName(chunkName);
    if(existing.hasNext()){
      var item=existing.next();
      if(item.getSize()!==expected)throw new Error('PO chunk conflict. Begin a new upload.');
      return {ok:true,chunkIndex:index,received:true,alreadyStored:true};
    }
    stage.createFile(Utilities.newBlob(bytes,'application/octet-stream',chunkName));
    return {ok:true,chunkIndex:index,received:true,alreadyStored:false};
  }finally{lock.releaseLock();}
}

/** Assemble verified, private chunks into a single official school PO. */
function siscDriveFinishChunkUpload_(request) {
  var info=siscPoChunkMeta_((request&&request.upload)||{});
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(25000))throw new Error('PO archive is busy. Retry finalization.');
  try{
    var parent=siscDriveFolder_();
    var existing=parent.getFilesByName(info.finalName);
    if(existing.hasNext())return siscPoStoredResult_(existing.next());
    var stage=siscPoStagingFolder_();
    var all=[];
    var staged=[];
    for(var index=0;index<info.chunkCount;index++){
      var matching=stage.getFilesByName(siscPoStageName_(info.uploadId,index));
      if(!matching.hasNext())throw new Error('Missing upload chunk '+index+'. Retry the upload.');
      var part=matching.next();
      var bytes=part.getBlob().getBytes();
      var expected=Math.min(SISC_PO_CHUNK_SIZE_,
        info.totalBytes-index*SISC_PO_CHUNK_SIZE_);
      if(bytes.length!==expected)throw new Error('PO upload chunk mismatch.');
      for(var j=0;j<bytes.length;j++)all.push(bytes[j]);
      staged.push(part);
    }
    if(all.length!==info.totalBytes)throw new Error('PO upload size mismatch.');
    siscDriveCheckMagic_(all,info.mime);
    var file=parent.createFile(Utilities.newBlob(all,info.mime,info.finalName));
    file.setDescription('Official PO '+info.po+
      (info.prf?' | PRF '+info.prf:'')+
      ' | School Supplier Evaluation private upload.');
    staged.forEach(function(part){try{part.setTrashed(true);}catch(ignore){}});
    return siscPoStoredResult_(file);
  }finally{lock.releaseLock();}
}

/** Return just one small verified piece; supports private PDF preview >4.5MB. */
function siscDriveGetPoChunk_(request) {
  var id=String(request&&request.fileId||'');
  var index=Number(request&&request.chunkIndex);
  if(!/^[A-Za-z0-9_-]{15,150}$/.test(id)||
    !Number.isInteger(index)||index<0||index>7){
    throw new Error('Invalid private PO document request.');
  }
  var parent=siscDriveFolder_();
  var file=DriveApp.getFileById(id);
  if(!siscWebhookFileInFolder_(file,parent.getId())){
    throw new Error('The PO is outside the approved private archive.');
  }
  var mime=siscDriveAllowedFile_({mimeType:file.getMimeType()});
  var size=file.getSize();
  if(size<1||size>SISC_PO_UPLOAD_LIMIT_)throw new Error('Unsupported PO document size.');
  var chunks=Math.ceil(size/SISC_PO_CHUNK_SIZE_);
  if(index>=chunks)throw new Error('PO chunk index is out of range.');
  var bytes=file.getBlob().getBytes();
  var part=bytes.slice(index*SISC_PO_CHUNK_SIZE_,(index+1)*SISC_PO_CHUNK_SIZE_);
  return {ok:true,fileId:id,mimeType:mime,totalBytes:size,
    chunkCount:chunks,chunkIndex:index,base64:Utilities.base64Encode(part)};
}

/** Safe read-only remote diagnostic for an authorized administrator. */
function siscDriveWebhookHealth_(){
  var result=siscDriveCheckFolderSetup();
  return {ok:true,folderAccessible:result.folderAccess==='verified',
    folderPrivate:result.folderPrivacy==='no-anyone-link',
    chunkUploadAvailable:true,chunkPreviewAvailable:true};
}

/**
 * Optional school-owned daily cleanup of orphaned temporary upload chunks.
 * Never touches finalized official POs or any other folder's files.
 * Schedule from the school Apps Script editor only after owner approval.
 */
function siscDriveCleanupStaging_(){
  var parent=siscDriveFolder_();
  var folders=parent.getFoldersByName(SISC_PO_STAGE_FOLDER_);
  if(!folders.hasNext())return {ok:true,scanned:0,deleted:0};
  var stage=folders.next();
  var files=stage.getFiles();
  var olderThan=Date.now()-24*60*60*1000;
  var scanned=0,deleted=0;
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(20000))throw new Error('PO archive is busy; retry cleanup.');
  try{
    while(files.hasNext()&&scanned<250){
      var file=files.next();
      scanned++;
      var name=file.getName();
      if(/^se-upload-[a-f0-9-]{36}-part-[0-7]$/.test(name)&&
        file.getDateCreated().getTime()<olderThan){
        file.setTrashed(true);
        deleted++;
      }
    }
  }finally{lock.releaseLock();}
  return {ok:true,scanned:scanned,deleted:deleted};
}
