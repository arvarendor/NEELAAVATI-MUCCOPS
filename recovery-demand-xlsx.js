(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./vendor/jszip.min.js"));
  } else {
    root.NMCRecoveryXlsx = factory(root.JSZip);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (JSZip) {
  "use strict";

  const CONTENT_TYPE =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function xml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function inlineCell(reference, value, style = 4) {
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  }

  function numberCell(reference, value, style = 5) {
    const numeric = Number(value || 0);
    return `<c r="${reference}" s="${style}"><v>${Number.isFinite(numeric) ? numeric : 0}</v></c>`;
  }

  function excelDateSerial(value) {
    const text = String(value || "").trim();
    let year;
    let month;
    let day;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (iso) [, year, month, day] = iso;
    else if (local) [, day, month, year] = local;
    else return null;
    const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
    if (!Number.isFinite(timestamp)) return null;
    return timestamp / 86400000 + 25569;
  }

  function dateCell(reference, value, style = 9) {
    const serial = excelDateSerial(value);
    return serial === null ? cell(reference, value, style) : numberCell(reference, serial, style);
  }

  function formulaCell(reference, formula, cachedValue, style = 9) {
    return `<c r="${reference}" s="${style}"><f>${xml(formula)}</f><v>${Number(cachedValue || 0)}</v></c>`;
  }

  function blankCell(reference, style = 4) {
    return `<c r="${reference}" s="${style}"/>`;
  }

  function cell(reference, value, style, kind = "string") {
    if (value === "" || value === null || value === undefined) return blankCell(reference, style);
    return kind === "number"
      ? numberCell(reference, value, style)
      : inlineCell(reference, value, style);
  }

  function cleanSheetName(value, fallback) {
    const clean = String(value || fallback || "Recovery")
      .replace(/[\\/*?:[\]]/g, " ")
      .trim()
      .slice(0, 31);
    return clean || fallback || "Recovery";
  }

  function memberDemandAmount(member) {
    if (member?.closed) return 0;
    if (member?.demand !== undefined && member?.demand !== null && member?.demand !== "") {
      return Math.max(0, Number(member.demand || 0));
    }
    return Math.max(0, Number(member?.emi || 0));
  }

  function uniqueSheetNames(sheets) {
    const used = new Set();
    return sheets.map((sheet, index) => {
      const base = cleanSheetName(sheet.name, `Recovery ${index + 1}`);
      let name = base;
      let suffix = 2;
      while (used.has(name.toLowerCase())) {
        const tail = ` ${suffix++}`;
        name = `${base.slice(0, 31 - tail.length)}${tail}`;
      }
      used.add(name.toLowerCase());
      return { ...sheet, name };
    });
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="16"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF76A5AF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEA9999"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="medium"><color rgb="FF000000"/></left>
      <right style="medium"><color rgb="FF000000"/></right>
      <top style="medium"><color rgb="FF000000"/></top>
      <bottom style="medium"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="2" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
  }

  function groupRecoveryStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="d/m/yyyy"/>
  </numFmts>
  <fonts count="8">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="28"/><name val="Aparajita"/><family val="2"/></font>
    <font><b/><sz val="12"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="12"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="9"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="11"/><color rgb="FFFF0000"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFF0000"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF898585"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF8496B0"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
    <border><left style="medium"><color rgb="FF000000"/></left><right style="medium"><color rgb="FF000000"/></right><top style="medium"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="17">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="165" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="165" fontId="4" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
  }

  function customerRepaymentStylesXml() {
    return groupRecoveryStylesXml().replace("FF8496B0", "FFB4C6E7");
  }

  function formatTimeLabel(value) {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
    if (!match) return String(value || "");
    const hour = Number(match[1]);
    const displayHour = hour % 12 || 12;
    return `${String(displayHour).padStart(2, "0")}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
  }

  function groupRecoveryWorksheetXml(sheet) {
    const columns = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    const rows = [];
    const merges = ["A1:I2", "A3:I3", "A4:I4", "A5:I5"];
    const mergedRow = (rowNumber, value, style, height) => {
      rows.push(`<row r="${rowNumber}" ht="${height}" customHeight="1">${inlineCell(`A${rowNumber}`, value, style)}${columns.slice(1).map((column) => blankCell(`${column}${rowNumber}`, style)).join("")}</row>`);
    };
    const detailRow = (rowNumber, leftLabel, leftValue, rightLabel = "", rightValue = "") => {
      const hasRight = Boolean(rightLabel);
      merges.push(`A${rowNumber}:B${rowNumber}`, hasRight ? `C${rowNumber}:D${rowNumber}` : `C${rowNumber}:I${rowNumber}`);
      if (hasRight) merges.push(`E${rowNumber}:F${rowNumber}`, `G${rowNumber}:I${rowNumber}`);
      rows.push(`<row r="${rowNumber}" ht="22" customHeight="1">${inlineCell(`A${rowNumber}`, leftLabel, 5)}${blankCell(`B${rowNumber}`, 5)}${cell(`C${rowNumber}`, leftValue, 6)}${blankCell(`D${rowNumber}`, 6)}${hasRight ? `${inlineCell(`E${rowNumber}`, rightLabel, 5)}${blankCell(`F${rowNumber}`, 5)}${cell(`G${rowNumber}`, rightValue, 6, typeof rightValue === "number" ? "number" : "string")}${blankCell(`H${rowNumber}`, 6)}${blankCell(`I${rowNumber}`, 6)}` : ["E", "F", "G", "H", "I"].map((column) => blankCell(`${column}${rowNumber}`, 6)).join("")}</row>`);
    };

    mergedRow(1, "NEELAVATI M.U.C.CO-OP.S . LTD.", 1, 31);
    rows.push(`<row r="2" ht="18" customHeight="1"></row>`);
    mergedRow(3, "NGP/RSR/CR/1542/2024, AYODHYA NAGAR , NAGPUR", 2, 22);
    mergedRow(4, "TAJ TOWER 2nd FLOOR AYODHYA NAGAR .  8329537470 , 7620007577 .", 3, 22);
    mergedRow(5, "", 4, 18);
    detailRow(6, "CENTRE ID", sheet.centreId, "CENTRE NAME", sheet.centreName);
    detailRow(7, "CENTRE REC DAY", String(sheet.recoveryDay || "").toUpperCase(), "CENTRE REC TIME", formatTimeLabel(sheet.recoveryTime));
    detailRow(8, "CENTRE REC AMT", `${Number(sheet.recoveryAmount || 0)}/-`, "NO OF MEMBERS", Number(sheet.memberCount || 0));
    detailRow(9, "CENTRE ADDRESS", sheet.centreAddress);
    detailRow(10, "GROUP LOAN AMT", `${Number(sheet.groupLoanAmount || 0)}/-`);
    detailRow(11, "GROUP LEADER-1", sheet.leader1);
    detailRow(12, "GROUP LEADER-2", sheet.leader2);
    detailRow(13, "EXECUTIVE NAME", sheet.executiveName);
    mergedRow(14, "", 4, 18);

    const headerTop = ["SR", "DATE", "UPDATE", "GROUP", "EMI", "ADVANCE", "CLOSING", "ATTEND", "REVIEW"];
    const headerBottom = ["NO", "", "TIME", "EMI", "", "", "", "MEMBER", ""];
    rows.push(`<row r="15" ht="22" customHeight="1">${headerTop.map((value, index) => inlineCell(`${columns[index]}15`, value, 7)).join("")}</row>`);
    rows.push(`<row r="16" ht="22" customHeight="1">${headerBottom.map((value, index) => cell(`${columns[index]}16`, value, 7)).join("")}</row>`);

    const schedule = Array.isArray(sheet.schedule) ? sheet.schedule : [];
    schedule.forEach((entry, index) => {
      const rowNumber = 17 + index;
      const isHoliday = entry.type === "holiday";
      const isClosing = entry.type === "closing" || /close/i.test(String(entry.review || ""));
      const baseStyle = isHoliday ? 12 : isClosing ? 13 : 8;
      const amountStyle = isHoliday ? 12 : isClosing ? 14 : 11;
      const reviewStyle = isHoliday ? 12 : isClosing ? 13 : 10;
      rows.push(`<row r="${rowNumber}" ht="20" customHeight="1">${
        cell(`A${rowNumber}`, isHoliday ? "HOLIDAY" : entry.number, baseStyle, typeof entry.number === "number" ? "number" : "string") +
        dateCell(`B${rowNumber}`, entry.date, isHoliday ? 16 : 9) +
        cell(`C${rowNumber}`, entry.updateTime, baseStyle) +
        blankCell(`D${rowNumber}`, amountStyle) +
        cell(`E${rowNumber}`, entry.emi, amountStyle, entry.emi === "" ? "string" : "number") +
        cell(`F${rowNumber}`, entry.advance, amountStyle, entry.advance === "" ? "string" : "number") +
        cell(`G${rowNumber}`, entry.closing, amountStyle, entry.closing === "" ? "string" : "number") +
        cell(`H${rowNumber}`, entry.attendance, baseStyle, entry.attendance === "" ? "string" : "number") +
        cell(`I${rowNumber}`, isHoliday ? entry.holidayName : entry.review, reviewStyle)
      }</row>`);
    });

    if (!schedule.length) {
      rows.push(`<row r="17" ht="20" customHeight="1">${columns.map((column) => blankCell(`${column}17`, 8)).join("")}</row>`);
    }

    const lastRow = Math.max(17, 16 + schedule.length);
    return {
      lastRow,
      lastColumn: "I",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:I${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="16" topLeftCell="A17" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="7" customWidth="1"/>
    <col min="2" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="13" customWidth="1"/>
    <col min="4" max="4" width="13" customWidth="1"/>
    <col min="5" max="7" width="13" customWidth="1"/>
    <col min="8" max="8" width="13" customWidth="1"/>
    <col min="9" max="9" width="37" customWidth="1"/>
  </cols>
  <sheetData>${rows.join("")}</sheetData>
  <mergeCells count="${merges.length}">${merges.map((reference) => `<mergeCell ref="${reference}"/>`).join("")}</mergeCells>
  <printOptions horizontalCentered="1"/>
  <pageMargins left="0.2" right="0.2" top="0.25" bottom="0.25" header="0.1" footer="0.1"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
  <headerFooter><oddFooter>&amp;CPage &amp;P of &amp;N</oddFooter></headerFooter>
</worksheet>`,
    };
  }

  function customerRepaymentWorksheetXml(sheet) {
    const columns = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];
    const rows = [];
    const merges = ["A1:K2", "A3:K3", "A4:K4", "A5:K5", "J7:K12", "J14:K19"];
    const mergedRow = (rowNumber, value, style, height) => {
      rows.push(`<row r="${rowNumber}" ht="${height}" customHeight="1">${inlineCell(`A${rowNumber}`, value, style)}${columns.slice(1).map((column) => blankCell(`${column}${rowNumber}`, style)).join("")}</row>`);
    };
    const detailRow = (rowNumber, label, value, options = {}) => {
      const cells = new Map();
      const setMerged = (start, end, content, style, kind = "string", isDate = false) => {
        merges.push(`${columns[start]}${rowNumber}:${columns[end]}${rowNumber}`);
        for (let index = start; index <= end; index += 1) {
          cells.set(index, index === start ? (isDate ? dateCell(`${columns[index]}${rowNumber}`, content, style) : cell(`${columns[index]}${rowNumber}`, content, style, kind)) : blankCell(`${columns[index]}${rowNumber}`, style));
        }
      };
      setMerged(0, 2, label, 5);
      if (options.splitTime) {
        setMerged(3, 5, value, 10);
        setMerged(6, 8, options.timeValue || "", 8);
      } else {
        setMerged(3, Number(options.valueEnd ?? 10), value, options.dateValue ? 9 : 10, options.numberValue ? "number" : "string", options.dateValue === true);
      }
      if (options.photoArea) {
        for (let index = 9; index <= 10; index += 1) {
          cells.set(index, options.photoLabel && index === 9 ? inlineCell(`${columns[index]}${rowNumber}`, options.photoLabel, 8) : blankCell(`${columns[index]}${rowNumber}`, 8));
        }
      }
      rows.push(`<row r="${rowNumber}" ht="22" customHeight="1">${columns.map((column, index) => cells.get(index) || blankCell(`${column}${rowNumber}`, 0)).join("")}</row>`);
    };

    mergedRow(1, "NEELAVATI M.U.C.CO-OP.S . LTD.", 1, 31);
    rows.push(`<row r="2" ht="18" customHeight="1"></row>`);
    mergedRow(3, "NGP/RSR/CR/1542/2024, AYODHYA NAGAR , NAGPUR", 2, 22);
    mergedRow(4, "TAJ TOWER 2nd FLOOR AYODHYA NAGAR .  8329537470 , 7620007577 .", 3, 22);
    mergedRow(5, "", 4, 18);
    detailRow(6, "LOAN ID", sheet.loanId, { valueEnd: 5 });
    detailRow(7, "CENTRE NAME", sheet.centreName, { valueEnd: 8, photoArea: true, photoLabel: "COUSTOMER" });
    detailRow(8, "CENTRE ADRESS", sheet.centreAddress, { valueEnd: 8, photoArea: true });
    detailRow(9, "CENTRE DAY/TIME", String(sheet.recoveryDay || "").toUpperCase(), { splitTime: true, timeValue: formatTimeLabel(sheet.recoveryTime), photoArea: true });
    detailRow(10, "COUSTOMER NAME", sheet.customerName, { valueEnd: 8, photoArea: true });
    detailRow(11, "GUARANTER NAME", sheet.guarantorName, { valueEnd: 8, photoArea: true });
    detailRow(12, "MOBILE NO", sheet.mobile, { valueEnd: 8, photoArea: true });
    detailRow(13, "COUSTOMER ADRESS", sheet.customerAddress);
    detailRow(14, "LOAN AMOUNT", `${Number(sheet.loanAmount || 0)}/-`, { valueEnd: 8, photoArea: true, photoLabel: "GUARANTEER" });
    detailRow(15, "DISBURSMENT DATE", sheet.disbursementDate, { valueEnd: 8, photoArea: true, dateValue: true });
    detailRow(16, "1 ST EMI DATE", sheet.firstEmiDate, { valueEnd: 8, photoArea: true, dateValue: true });
    detailRow(17, "LAST EMI DATE", sheet.lastEmiDate, { valueEnd: 8, photoArea: true, dateValue: true });
    detailRow(18, "NO OF INSTALLMENT", `${Number(sheet.installments || 0)} weeks`, { valueEnd: 8, photoArea: true });
    detailRow(19, "PURPOSE OF LOAN", sheet.loanPurpose, { valueEnd: 8, photoArea: true });
    detailRow(20, "EXECUTIVE NAME", sheet.executiveName);
    mergedRow(21, "", 4, 18);

    const headerTop = ["SR", "DATE", "RECIPT", "EMI", "EMI RECEIVED", "PENALTY"];
    const headerBottom = ["NO", "", "NO", "", "", ""];
    merges.push("G22:K22", "G23:K23");
    rows.push(`<row r="22" ht="22" customHeight="1">${headerTop.map((value, index) => inlineCell(`${columns[index]}22`, value, 7)).join("")}${inlineCell("G22", "REVIEW", 7)}${["H", "I", "J", "K"].map((column) => blankCell(`${column}22`, 7)).join("")}</row>`);
    rows.push(`<row r="23" ht="22" customHeight="1">${headerBottom.map((value, index) => cell(`${columns[index]}23`, value, 7)).join("")}${["G", "H", "I", "J", "K"].map((column) => blankCell(`${column}23`, 7)).join("")}</row>`);

    const schedule = Array.isArray(sheet.schedule) ? [...sheet.schedule] : [];
    const lastInstallmentNumber = schedule.reduce((maximum, entry) => Math.max(maximum, Number(entry.number || 0)), 0);
    for (let number = lastInstallmentNumber + 1; number <= 35; number += 1) {
      schedule.push({ number, date: "", receipt: "", emi: "", received: "", penalty: "", review: "" });
    }
    if (!schedule.length) schedule.push({ number: 1, date: "", receipt: "", emi: "", received: "", penalty: "", review: "" });

    schedule.forEach((entry, index) => {
      const rowNumber = 24 + index;
      const isHoliday = entry.type === "holiday";
      const isClosing = entry.type === "closing" || /close/i.test(String(entry.review || ""));
      const baseStyle = isHoliday ? 12 : isClosing ? 13 : 8;
      const amountStyle = isHoliday ? 12 : isClosing ? 14 : 11;
      const reviewStyle = isHoliday ? 12 : isClosing ? 13 : 10;
      merges.push(`G${rowNumber}:K${rowNumber}`);
      rows.push(`<row r="${rowNumber}" ht="20" customHeight="1">${
        cell(`A${rowNumber}`, isHoliday ? "HOLIDAY" : entry.number, baseStyle, typeof entry.number === "number" ? "number" : "string") +
        dateCell(`B${rowNumber}`, entry.date, isHoliday ? 16 : 9) +
        cell(`C${rowNumber}`, entry.receipt, baseStyle) +
        cell(`D${rowNumber}`, entry.emi, amountStyle, entry.emi === "" ? "string" : "number") +
        cell(`E${rowNumber}`, entry.received, amountStyle, entry.received === "" ? "string" : "number") +
        cell(`F${rowNumber}`, entry.penalty, amountStyle, entry.penalty === "" ? "string" : "number") +
        cell(`G${rowNumber}`, isHoliday ? entry.holidayName : entry.review, reviewStyle) +
        ["H", "I", "J", "K"].map((column) => blankCell(`${column}${rowNumber}`, reviewStyle)).join("")
      }</row>`);
    });

    const lastRow = 23 + schedule.length;
    return {
      lastRow,
      lastColumn: "K",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:K${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="23" topLeftCell="A24" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="7" customWidth="1"/>
    <col min="2" max="2" width="15" customWidth="1"/>
    <col min="3" max="6" width="15" customWidth="1"/>
    <col min="7" max="11" width="17" customWidth="1"/>
  </cols>
  <sheetData>${rows.join("")}</sheetData>
  <mergeCells count="${merges.length}">${merges.map((reference) => `<mergeCell ref="${reference}"/>`).join("")}</mergeCells>
  <printOptions horizontalCentered="1"/>
  <pageMargins left="0.2" right="0.2" top="0.25" bottom="0.25" header="0.1" footer="0.1"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
  <headerFooter><oddFooter>&amp;CPage &amp;P of &amp;N</oddFooter></headerFooter>
</worksheet>`,
    };
  }

  function worksheetXml(sheet) {
    const rows = [];
    const totalReferences = [];
    let rowNumber = 1;

    rows.push(
      `<row r="${rowNumber}" ht="25" customHeight="1">${inlineCell(
        `A${rowNumber}`,
        sheet.title,
        1
      )}${["B", "C", "D", "E", "F", "G"].map((column) => blankCell(`${column}${rowNumber}`, 1)).join("")}</row>`
    );
    rowNumber += 1;

    const headers = ["SR NO", "GN", "CENTER NAME", "CENTER LEADER", "CONTACT", "REC", "TOTAL"];
    rows.push(
      `<row r="${rowNumber}" ht="22" customHeight="1">${headers
        .map((header, index) => inlineCell(`${String.fromCharCode(65 + index)}${rowNumber}`, header, 2))
        .join("")}</row>`
    );
    rowNumber += 1;

    sheet.groups.forEach((group, groupIndex) => {
      const members = Array.isArray(group.members) ? group.members : [];
      const startRow = rowNumber;
      const firstEmi = group.firstEmi ? `FIRST EMI (${group.firstEmi})` : "FIRST EMI";
      const total = members.reduce(
        (sum, member) => sum + memberDemandAmount(member),
        0
      );

      members.forEach((member, memberIndex) => {
        const closed = member.closed === true;
        const leader = memberIndex < 2 ? `   (G.L ${memberIndex + 1})` : "";
        const memberId = String(member.loanId || `A-${memberIndex + 1}`).replace(/\)+$/, "");
        const demandDetails = [
          Number(member.pendingEmiCount || 0) > 1 ? `${Number(member.pendingEmiCount)} EMI` : "",
          Number(member.penalty || 0) > 0 ? `PENALTY ${Number(member.penalty)}` : "",
        ].filter(Boolean).join(" + ");
        const centreDetail =
          memberIndex === 0
            ? group.centreName
            : memberIndex === 1
              ? firstEmi
              : memberIndex === 2
                ? group.loaningStaff || group.recoveryStaff || ""
                : "";
        const cells = [
          cell(`A${rowNumber}`, memberIndex === 0 ? groupIndex + 1 : "", 3, "number"),
          cell(`B${rowNumber}`, memberIndex === 0 ? group.groupNumber : "", 3),
          cell(`C${rowNumber}`, centreDetail, 4),
          cell(`D${rowNumber}`, `${memberId}) ${member.name || "Customer"}${leader}`, closed ? 6 : 4),
          cell(`E${rowNumber}`, member.mobile || "", closed ? 6 : 3),
          cell(`F${rowNumber}`, memberDemandAmount(member), closed ? 7 : 5, "number"),
          cell(`G${rowNumber}`, closed ? "CLOSE" : demandDetails, closed ? 6 : 4),
        ];
        rows.push(`<row r="${rowNumber}" ht="20" customHeight="1">${cells.join("")}</row>`);
        rowNumber += 1;
      });

      const endRow = Math.max(startRow, rowNumber - 1);
      const totalRow = rowNumber;
      totalReferences.push(`G${totalRow}`);
      rows.push(
        `<row r="${totalRow}" ht="21" customHeight="1">` +
          ["A", "B", "C", "D", "E"].map((column) => blankCell(`${column}${totalRow}`, 4)).join("") +
          inlineCell(`F${totalRow}`, "TOTAL-", 8) +
          formulaCell(
            `G${totalRow}`,
            `SUMIF(G${startRow}:G${endRow},"<>CLOSE",F${startRow}:F${endRow})`,
            total,
            9
          ) +
          "</row>"
      );
      rowNumber += 1;
    });

    if (!sheet.groups.length) {
      rows.push(
        `<row r="${rowNumber}" ht="22" customHeight="1">${inlineCell(
          `A${rowNumber}`,
          "No active recovery demand",
          4
        )}${["B", "C", "D", "E", "F", "G"].map((column) => blankCell(`${column}${rowNumber}`, 4)).join("")}</row>`
      );
      rowNumber += 1;
    }

    rowNumber += 1;
    const grandTotalRow = rowNumber;
    const grandTotal = sheet.groups.reduce(
      (sum, group) =>
        sum +
        (group.members || []).reduce(
          (groupSum, member) =>
            groupSum + memberDemandAmount(member),
          0
        ),
      0
    );
    rows.push(
      `<row r="${grandTotalRow}" ht="22" customHeight="1">` +
        ["A", "B", "C", "D", "E"].map((column) => blankCell(`${column}${grandTotalRow}`, 4)).join("") +
        inlineCell(`F${grandTotalRow}`, "TOTAL", 8) +
        formulaCell(
          `G${grandTotalRow}`,
          totalReferences.length ? `SUM(${totalReferences.join(",")})` : "0",
          grandTotal,
          10
        ) +
        "</row>"
    );

    return {
      lastRow: grandTotalRow,
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:G${grandTotalRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="7" customWidth="1"/>
    <col min="2" max="2" width="12" customWidth="1"/>
    <col min="3" max="3" width="27" customWidth="1"/>
    <col min="4" max="4" width="46" customWidth="1"/>
    <col min="5" max="5" width="16" customWidth="1"/>
    <col min="6" max="6" width="12" customWidth="1"/>
    <col min="7" max="7" width="17" customWidth="1"/>
  </cols>
  <sheetData>${rows.join("")}</sheetData>
  <mergeCells count="1"><mergeCell ref="A1:G1"/></mergeCells>
  <printOptions horizontalCentered="1"/>
  <pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.15" footer="0.15"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
  <headerFooter><oddFooter>&amp;CPage &amp;P of &amp;N</oddFooter></headerFooter>
</worksheet>`,
    };
  }

  function contentTypesXml(sheetCount) {
    const sheets = Array.from(
      { length: sheetCount },
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPE}.main+xml"/>
  ${sheets}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  }

  function workbookXml(sheets, worksheetResults) {
    const sheetElements = sheets
      .map(
        (sheet, index) =>
          `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      )
      .join("");
    const printAreas = sheets
      .map((sheet, index) => {
        const quotedName = sheet.name.replaceAll("'", "''");
        return `<definedName name="_xlnm.Print_Area" localSheetId="${index}">'${xml(
          quotedName
          )}'!$A$1:$${worksheetResults[index].lastColumn || "G"}$${worksheetResults[index].lastRow}</definedName>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr date1904="0"/>
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="15000"/></bookViews>
  <sheets>${sheetElements}</sheets>
  <definedNames>${printAreas}</definedNames>
  <calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`;
  }

  function workbookRelationshipsXml(sheetCount) {
    const relationships = Array.from(
      { length: sheetCount },
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    ).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationships}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  }

  function appPropertiesXml(sheets) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>NEELAVATI MUCCOPS</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets
    .map((sheet) => `<vt:lpstr>${xml(sheet.name)}</vt:lpstr>`)
    .join("")}</vt:vector></TitlesOfParts>
  <Company>NEELAVATI MUCCOPS</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0300</AppVersion>
</Properties>`;
  }

  function corePropertiesXml(title = "Staff Recovery Demand") {
    const timestamp = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>NEELAVATI MUCCOPS</dc:creator>
  <cp:lastModifiedBy>NEELAVATI MUCCOPS</cp:lastModifiedBy>
  <dc:title>${xml(title)}</dc:title>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`;
  }

  async function buildRecoveryDemandWorkbook(options = {}) {
    if (!JSZip) throw new Error("The Excel download engine could not be loaded.");
    const sheets = uniqueSheetNames(Array.isArray(options.sheets) ? options.sheets : []);
    if (!sheets.length) throw new Error("No recovery demand sheets were supplied.");

    const zip = new JSZip();
    const worksheetResults = sheets.map(worksheetXml);
    zip.file("[Content_Types].xml", contentTypesXml(sheets.length));
    zip.folder("_rels").file(
      ".rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    );
    zip.folder("docProps").file("core.xml", corePropertiesXml());
    zip.folder("docProps").file("app.xml", appPropertiesXml(sheets));
    zip.folder("xl").file("workbook.xml", workbookXml(sheets, worksheetResults));
    zip.folder("xl").folder("_rels").file(
      "workbook.xml.rels",
      workbookRelationshipsXml(sheets.length)
    );
    zip.folder("xl").file("styles.xml", stylesXml());
    worksheetResults.forEach((result, index) => {
      zip.folder("xl").folder("worksheets").file(`sheet${index + 1}.xml`, result.xml);
    });

    const outputType =
      options.outputType || (typeof Blob === "undefined" ? "nodebuffer" : "blob");
    return zip.generateAsync({
      type: outputType,
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      mimeType: CONTENT_TYPE,
    });
  }

  async function buildGroupRecoveryWorkbook(options = {}) {
    if (!JSZip) throw new Error("The Excel download engine could not be loaded.");
    const sheet = {
      ...options,
      name: cleanSheetName(options.sheetName || options.groupNumber, "Weekly Recovery"),
    };
    const worksheetResult = groupRecoveryWorksheetXml(sheet);
    const sheets = [sheet];
    const zip = new JSZip();
    zip.file("[Content_Types].xml", contentTypesXml(1));
    zip.folder("_rels").file(
      ".rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    );
    zip.folder("docProps").file("core.xml", corePropertiesXml("Weekly Group Recovery"));
    zip.folder("docProps").file("app.xml", appPropertiesXml(sheets));
    zip.folder("xl").file("workbook.xml", workbookXml(sheets, [worksheetResult]));
    zip.folder("xl").folder("_rels").file("workbook.xml.rels", workbookRelationshipsXml(1));
    zip.folder("xl").file("styles.xml", groupRecoveryStylesXml());
    zip.folder("xl").folder("worksheets").file("sheet1.xml", worksheetResult.xml);

    const outputType = options.outputType || (typeof Blob === "undefined" ? "nodebuffer" : "blob");
    return zip.generateAsync({
      type: outputType,
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      mimeType: CONTENT_TYPE,
    });
  }

  async function buildCustomerRepaymentWorkbook(options = {}) {
    if (!JSZip) throw new Error("The Excel download engine could not be loaded.");
    const sheet = {
      ...options,
      name: cleanSheetName(options.sheetName || options.customerCode, "Customer Repayment"),
    };
    const worksheetResult = customerRepaymentWorksheetXml(sheet);
    const sheets = [sheet];
    const zip = new JSZip();
    zip.file("[Content_Types].xml", contentTypesXml(1));
    zip.folder("_rels").file(
      ".rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    );
    zip.folder("docProps").file("core.xml", corePropertiesXml("Customer Repayment Schedule"));
    zip.folder("docProps").file("app.xml", appPropertiesXml(sheets));
    zip.folder("xl").file("workbook.xml", workbookXml(sheets, [worksheetResult]));
    zip.folder("xl").folder("_rels").file("workbook.xml.rels", workbookRelationshipsXml(1));
    zip.folder("xl").file("styles.xml", customerRepaymentStylesXml());
    zip.folder("xl").folder("worksheets").file("sheet1.xml", worksheetResult.xml);

    const outputType = options.outputType || (typeof Blob === "undefined" ? "nodebuffer" : "blob");
    return zip.generateAsync({
      type: outputType,
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      mimeType: CONTENT_TYPE,
    });
  }

  return { buildRecoveryDemandWorkbook, buildGroupRecoveryWorkbook, buildCustomerRepaymentWorkbook };
});

