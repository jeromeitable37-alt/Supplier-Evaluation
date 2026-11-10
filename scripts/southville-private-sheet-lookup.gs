/**
 * SupplierEvaluationPrivateLookup.gs — add-on, not a replacement for Code.gs.
 *
 * Read-only, server-authorized school-sheet lookup for an otherwise private
 * official workbook. The webhook's doPost validates PMS_WEBHOOK_SECRET first.
 * This function is never invoked directly by a public website client.
 *
 * Script Properties:
 *   SUPPLIER_SHEET_ID (existing official workbook)
 *   SUPPLIER_V2_SHEET_ID (optional separate PRF monitoring workbook)
 */
var SISC_LOOKUP_OFFICIAL_TABS_ = [
  'PO for Evaluation', 'PRF Details v2', 'PRF Details',
  'Requisitioner Details', 'Employee', 'POs', 'Items', 'Requests'
];
var SISC_LOOKUP_V2_TABS_ = [
  'PRF - SISC', 'PRF-TROPICAL PALMS', 'PRF-SMIS', 'PRF-SSLC',
  'PRF-TREX', 'PRF-ACT', 'PRF-ASAT', 'PRF-SGEN', 'PRF-SISFU',
  'PRF-CMIP', 'PRF - AFSL', 'PRF-SVILLE EDUVISION', 'PRF-AASHPI'
];

function siscPrivateSheetRead_(request, props) {
  var source = String(request && request.source || '');
  var name = String(request && request.sheetName || '');
  var list = source === 'official'
    ? SISC_LOOKUP_OFFICIAL_TABS_
    : source === 'v2' ? SISC_LOOKUP_V2_TABS_ : [];
  if (list.indexOf(name) < 0) throw new Error('The requested sheet is not authorized.');
  var property = source === 'official' ? 'SUPPLIER_SHEET_ID' : 'SUPPLIER_V2_SHEET_ID';
  var spreadsheetId = String(props.getProperty(property) || '');
  if (!spreadsheetId) throw new Error('Authorized school sheet property is missing.');
  var book = SpreadsheetApp.openById(spreadsheetId);
  var sheet = book.getSheetByName(name);
  if (!sheet) {
    return {ok:true,source:source,sheetName:name,rows:[],lastRow:0,missing:true};
  }
  var start = Math.floor(Number(request.startRow || 1));
  var requestedLimit = Math.floor(Number(request.maxRows || 1000));
  if (!isFinite(start) || start < 1 || start > 10000 ||
      !isFinite(requestedLimit) || requestedLimit < 1) {
    throw new Error('Invalid bounded sheet page.');
  }
  var limit = Math.min(1500,requestedLimit);
  var last = Math.min(10000,sheet.getLastRow());
  var width = Math.min(60,sheet.getLastColumn());
  if (!last || !width || start > last) {
    return {ok:true,source:source,sheetName:name,rows:[],lastRow:last};
  }
  var count = Math.min(limit,last-start+1);
  var values = sheet.getRange(start,1,count,width).getDisplayValues();
  return {
    ok:true,source:source,sheetName:name,fromRow:start,
    lastRow:last,rows:values
  };
}

/**
 * Read-only setup check for Sir GC. No school record values are printed.
 */
function siscPrivateLookupCheckSetup() {
  var props=PropertiesService.getScriptProperties();
  var official=String(props.getProperty('SUPPLIER_SHEET_ID')||'');
  if(!official)throw new Error('SUPPLIER_SHEET_ID is missing.');
  var book=SpreadsheetApp.openById(official);
  var hasPo=!!book.getSheetByName('PO for Evaluation');
  var hasPrf=!!book.getSheetByName('PRF Details v2');
  var v2=String(props.getProperty('SUPPLIER_V2_SHEET_ID')||'');
  var secondary=v2?SpreadsheetApp.openById(v2):null;
  var result={
    ok:hasPo&&hasPrf,officialWorkbookReadable:true,
    poTabPresent:hasPo,prfTabPresent:hasPrf,
    v2WorkbookReadable:!!secondary,
    readOnly:true,
  };
  Logger.log(JSON.stringify(result));
  return result;
}
