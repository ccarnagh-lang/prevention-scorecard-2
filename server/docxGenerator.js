const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
  Header, Footer, LevelFormat,
} = require('docx');

const NAVY   = '1B3A5C';
const TEAL   = '0F6E56';
const TEAL2  = '1D9E75';
const LTEAL  = 'E1F5EE';
const PURPLE = '534AB7';
const RED    = 'A32D2D';
const AMBER  = 'BA7517';
const DKGRAY = '4A5568';
const MGRAY  = 'BEC8D2';
const WHITE  = 'FFFFFF';
const LRED   = 'FCEBEB';
const LGREEN = 'EAF3DE';
const LGRAY  = 'F5F7FA';

const bdr = (c='CCCCCC', sz=4) => ({ style: BorderStyle.SINGLE, size: sz, color: c });
const noBdr = () => ({ style: BorderStyle.NONE, size: 0, color: 'FFFFFF' });
const allBdrs = (c='CCCCCC', sz=4) => ({ top: bdr(c,sz), bottom: bdr(c,sz), left: bdr(c,sz), right: bdr(c,sz) });
const noBdrs = () => ({ top: noBdr(), bottom: noBdr(), left: noBdr(), right: noBdr() });
const cm = { top:100, bottom:100, left:140, right:140 };

function sp(n=120) {
  return new Paragraph({ spacing: { before: n, after: 0 }, children: [new TextRun('')] });
}

function secTitle(text) {
  return new Paragraph({
    spacing: { before: 280, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY } },
    children: [new TextRun({ text, bold: true, size: 22, font: 'Arial', color: NAVY, allCaps: true })]
  });
}

function lv(label, value, lw=2520, vw=6480) {
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [lw, vw],
    borders: { top: noBdr(), bottom: noBdr(), left: noBdr(), right: noBdr(), insideH: noBdr(), insideV: noBdr() },
    rows: [new TableRow({ children: [
      new TableCell({ borders: noBdrs(), width: { size: lw, type: WidthType.DXA },
        margins: { top:40, bottom:40, left:0, right:100 },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold:true, size:18, font:'Arial', color:DKGRAY })] })] }),
      new TableCell({ borders: noBdrs(), width: { size: vw, type: WidthType.DXA },
        margins: { top:40, bottom:40, left:0, right:0 },
        children: [new Paragraph({ children: [new TextRun({ text: value||'—', size:18, font:'Arial', color:'111111' })] })] }),
    ]})]
  });
}

function reqTableRow(id, name, response, notes, shade) {
  const rc = response === 'Yes' ? '27500A' : response === 'No' ? '791F1F' : response === 'Some but not all' ? '633806' : DKGRAY;
  const rb = response === 'Yes' ? LGREEN : response === 'No' ? LRED : response === 'Some but not all' ? 'FAEEDA' : LGRAY;
  const bg = shade ? LGRAY : WHITE;
  return new TableRow({ children: [
    new TableCell({ borders: allBdrs('E2E8F0'), width: { size:650, type:WidthType.DXA }, shading:{ fill:bg, type:ShadingType.CLEAR }, margins:cm, verticalAlign:VerticalAlign.CENTER,
      children: [new Paragraph({ alignment:AlignmentType.CENTER, children:[new TextRun({ text:id, bold:true, size:16, font:'Arial', color:PURPLE })] })] }),
    new TableCell({ borders: allBdrs('E2E8F0'), width: { size:3100, type:WidthType.DXA }, shading:{ fill:bg, type:ShadingType.CLEAR }, margins:cm,
      children: [new Paragraph({ children:[new TextRun({ text:name, size:17, font:'Arial', color:'111111' })] })] }),
    new TableCell({ borders: allBdrs('E2E8F0'), width: { size:1050, type:WidthType.DXA }, shading:{ fill:rb, type:ShadingType.CLEAR }, margins:cm, verticalAlign:VerticalAlign.CENTER,
      children: [new Paragraph({ alignment:AlignmentType.CENTER, children:[new TextRun({ text:response||'—', bold:true, size:16, font:'Arial', color:rc })] })] }),
    new TableCell({ borders: allBdrs('E2E8F0'), width: { size:4200, type:WidthType.DXA }, shading:{ fill:bg, type:ShadingType.CLEAR }, margins:cm,
      children: [new Paragraph({ children:[new TextRun({ text:notes||'', size:16, font:'Arial', color:'333333', italics:!notes })] })] }),
  ]});
}

function reqTable(items, nameMap) {
  const hdr = new TableRow({ tableHeader:true, children:[
    ...['ID','Requirement','Response','Notes / Observations'].map((h,i) =>
      new TableCell({ borders:allBdrs(TEAL,6), width:{ size:[650,3100,1050,4200][i], type:WidthType.DXA },
        shading:{ fill:NAVY, type:ShadingType.CLEAR }, margins:cm, verticalAlign:VerticalAlign.CENTER,
        children:[new Paragraph({ alignment: i<2||i===3 ? AlignmentType.LEFT : AlignmentType.CENTER,
          children:[new TextRun({ text:h, bold:true, size:17, font:'Arial', color:WHITE })] })] }))
  ]});
  return new Table({
    width: { size:9000, type:WidthType.DXA },
    columnWidths: [650, 3100, 1050, 4200],
    rows: [hdr, ...items.map((r,i) => reqTableRow(r.id, nameMap[r.id]||r.id, r.response, r.notes, i%2===1))]
  });
}

function sigBlock(label, value, lineW=4500, rightLabel='', rightValue='', rightW=4500) {
  return new Table({
    width:{ size:9000, type:WidthType.DXA }, columnWidths:[lineW, rightW],
    borders:{ top:noBdr(), bottom:noBdr(), left:noBdr(), right:noBdr(), insideH:noBdr(), insideV:noBdr() },
    rows:[new TableRow({ children:[
      new TableCell({ borders:noBdrs(), width:{ size:lineW, type:WidthType.DXA }, margins:{ top:0, bottom:0, left:0, right:200 },
        children:[
          new Paragraph({ border:{ bottom:{ style:BorderStyle.SINGLE, size:6, color:NAVY } }, spacing:{ before:180, after:20 },
            children:[new TextRun({ text: value||' ', size:17, font:value?'Georgia':'Arial', italics:!!value, color:value?'111111':'FFFFFF' })] }),
          new Paragraph({ children:[new TextRun({ text:label, size:15, font:'Arial', color:DKGRAY })] })
        ]
      }),
      new TableCell({ borders:noBdrs(), width:{ size:rightW, type:WidthType.DXA }, margins:{ top:0, bottom:0, left:0, right:0 },
        children: rightLabel ? [
          new Paragraph({ border:{ bottom:{ style:BorderStyle.SINGLE, size:6, color:NAVY } }, spacing:{ before:180, after:20 },
            children:[new TextRun({ text:rightValue||' ', size:17, font:rightValue?'Georgia':'Arial', italics:!!rightValue, color:rightValue?'111111':'FFFFFF' })] }),
          new Paragraph({ children:[new TextRun({ text:rightLabel, size:15, font:'Arial', color:DKGRAY })] })
        ] : [new Paragraph({ children:[new TextRun('')]  })]
      }),
    ]})]
  });
}

const REQ_NAMES = {
  W1:'Notes documented in Connections (EHR)',
  W2:'PROMIS contacts documented',
  W3:'Progress note written using program template',
  W4:'Casework contact standards met',
  W5:'Diligent efforts when standards not met',
  W6:'Head of household seen / assessed',
  W9:'Safety concerns raised',
  W10:'Safety plan documented when concerns raised',
  W11:'Child welfare risk raised',
  W12:'Controlling factors implemented',
  M1:'Child under 2 years old in the home',
  M2:'Safe sleep discussed when applicable',
  M3:'Parent/Caretaker-child interaction assessed',
  M4:'ACS collaboration held when applicable',
  M5:'Family supports and resources explored',
  M6:'Home assessment completed',
  Q1:'FASP completed before deadline',
  Q2:'FASP approved by ACS prior to due date',
  Q2A:'FASP signatures obtained (unscored)',
  Q3:'Cultural assessment documented',
  Q4:'Collateral contacts completed',
  Q5:'Other household members identified',
  Q6:'Household members engaged when applicable',
  Q7:'Both parents included in service planning',
  Q8:'Home assessment with safety review',
  Q9:'Financial resources in home assessment',
  Q10:'Parent living outside the home engaged',
  Q10A:'Barriers to engaging outside parent documented',
  Q11:'FTC held',
  Q12:'Family invited to FTC',
  Q12A:'ACS invited to FTC (if applicable)',
  Q13:'FTC follow-up tasks completed',
  Q14:'Children 10+ invited to FTC',
  Q15:'Separate conferences held when IPV/DV indicated',
  Q16:'Service plan aligns with FTC goals',
  Q17:'FTC action plan followed within timeframe',
};

async function generateSupNote(data) {
  const {
    caseId, supervisorName, supervisorLicense, supervisorTitle,
    narrative, dischargeReady, dischargeNotes, signature, signatureDate,
    roster, latest, entries,
  } = data;

  const today = new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
  const planner     = roster?.planner     || latest?.case_planner || 'N/A';
  const program     = roster?.program     || latest?.team_site    || 'N/A';
  const modality    = roster?.modality    || 'N/A';
  const hhId        = roster?.household_id|| latest?.household_id || 'N/A';
  const openDate    = roster?.open_date   || 'N/A';
  const weekEnding  = latest?.week_ending || 'N/A';
  const weeklyScore = latest?.weekly_score   != null ? Math.round(latest.weekly_score)   + '%' : '—';
  const monthlyScore= latest?.monthly_score  != null ? Math.round(latest.monthly_score)  + '%' : '—';
  const quarterlyScore = latest?.quarterly_score != null ? Math.round(latest.quarterly_score) + '%' : '—';
  const lifetimeScore  = latest?.lifetime_score  != null ? Math.round(latest.lifetime_score)  + '%' : '—';
  const faspStatus  = latest?.fasp_status   || 'Pending';
  const safetyFlag  = latest?.safety_flag   || 'No';
  const submissionNotes = latest?.submission_notes || '';
  const childCount  = roster?.children_count || latest?.children_count || 0;

  const responses   = latest?.responses || [];
  const byId = {};
  responses.forEach(r => { byId[r.id] = r; });

  const weekly    = ['W1','W2','W3','W4','W5','W6','W9','W10','W11','W12'].map(id => ({ id, response: byId[id]?.response||'—', notes: byId[id]?.notes||'' }));
  const monthly   = ['M1','M2','M4','M5','M6'].map(id => ({ id, response: byId[id]?.response||'—', notes: byId[id]?.notes||'' }));
  const quarterly = ['Q1','Q2','M3','Q3','Q4','Q5','Q6','Q7','Q11','Q12','Q13','Q14','Q16','Q17'].map(id => ({ id, response: byId[id]?.response||'—', notes: byId[id]?.notes||'' }));

  const ratingPct = latest?.weekly_score || 0;
  const rating = ratingPct >= 90 ? 'Strong' : ratingPct >= 75 ? 'Adequate' : 'Needs Attention';
  const ratingColor = ratingPct >= 90 ? '27500A' : ratingPct >= 75 ? '633806' : '791F1F';
  const ratingBg    = ratingPct >= 90 ? LGREEN   : ratingPct >= 75 ? 'FAEEDA' : LRED;

  const scoreRow = (label, value, bg) => new TableCell({
    borders: allBdrs(TEAL, 6), width: { size:2250, type:WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: { top:80, bottom:80, left:80, right:80 }, verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({ alignment:AlignmentType.CENTER, children:[new TextRun({ text:label, bold:true, size:16, font:'Arial', color:'9FE1CB' })] }),
      new Paragraph({ alignment:AlignmentType.CENTER, children:[new TextRun({ text:value,  bold:true, size:36, font:'Arial', color: value==='—'?'888888':'F09595' })] }),
    ]
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 19 } } } },
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{ level:0, format:LevelFormat.BULLET, text:'•', alignment:AlignmentType.LEFT,
          style: { paragraph: { indent: { left:440, hanging:220 } } } }]
      }]
    },
    sections: [{
      properties: {
        page: {
          size: { width:12240, height:15840 },
          margin: { top:1080, right:1080, bottom:1080, left:1080 }
        }
      },
      headers: {
        default: new Header({
          children: [new Table({
            width: { size:10080, type:WidthType.DXA }, columnWidths:[7200,2880],
            borders: { top:noBdr(), bottom:noBdr(), left:noBdr(), right:noBdr(), insideH:noBdr(), insideV:noBdr() },
            rows: [new TableRow({ children:[
              new TableCell({ borders:noBdrs(), width:{ size:7200, type:WidthType.DXA }, margins:{ top:0, bottom:0, left:0, right:0 },
                children:[
                  new Paragraph({ border:{ bottom:{ style:BorderStyle.SINGLE, size:12, color:NAVY } }, spacing:{ after:40 },
                    children:[new TextRun({ text: program + ' — Prevention Services', bold:true, size:20, font:'Arial', color:NAVY })] }),
                  new Paragraph({ children:[new TextRun({ text:'Supervisory Case Note  |  Confidential', size:17, font:'Arial', color:DKGRAY })] })
                ]
              }),
              new TableCell({ borders:noBdrs(), width:{ size:2880, type:WidthType.DXA }, margins:{ top:0, bottom:0, left:0, right:0 }, verticalAlign:VerticalAlign.CENTER,
                children:[
                  new Paragraph({ alignment:AlignmentType.RIGHT, children:[new TextRun({ text:`Case: ${caseId}`, bold:true, size:18, font:'Arial', color:NAVY })] }),
                  new Paragraph({ alignment:AlignmentType.RIGHT, children:[new TextRun({ text:today, size:16, font:'Arial', color:DKGRAY })] }),
                ]
              }),
            ]})]
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            border: { top:{ style:BorderStyle.SINGLE, size:4, color:MGRAY } },
            spacing: { before:80 },
            children:[
              new TextRun({ text:`${program}  |  Supervisor: ${supervisorName||'N/A'}  |  `, size:15, font:'Arial', color:DKGRAY }),
              new TextRun({ text:'CONFIDENTIAL — Authorized personnel only', size:15, font:'Arial', color:DKGRAY }),
            ]
          })]
        })
      },
      children: [
        sp(80),
        new Paragraph({ spacing:{ before:0, after:60 }, children:[
          new TextRun({ text:'Supervisory Case Note & Compliance Report', bold:true, size:32, font:'Arial', color:NAVY })
        ]}),

        new Table({
          width:{ size:9000, type:WidthType.DXA }, columnWidths:[4500,4500],
          borders:{ top:noBdr(), bottom:noBdr(), left:noBdr(), right:noBdr(), insideH:noBdr(), insideV:noBdr() },
          rows:[new TableRow({ children:[
            new TableCell({ borders:noBdrs(), width:{ size:4500, type:WidthType.DXA }, shading:{ fill:LGRAY, type:ShadingType.CLEAR }, margins:{ top:120, bottom:120, left:180, right:100 },
              children:[lv('Case ID:',caseId,1700,2600), lv('Household ID:',hhId,1700,2600), lv('Case Planner:',planner,1700,2600), lv('Program:',program,1700,2600), lv('Modality:',modality,1700,2600)] }),
            new TableCell({ borders:noBdrs(), width:{ size:4500, type:WidthType.DXA }, shading:{ fill:LGRAY, type:ShadingType.CLEAR }, margins:{ top:120, bottom:120, left:180, right:180 },
              children:[lv('Report Date:',today,1800,2520), lv('Week Ending:',weekEnding,1800,2520), lv('Case Open:',openDate,1800,2520), lv('Supervisor:',supervisorName||'N/A',1800,2520), lv('FASP Status:',faspStatus,1800,2520)] }),
          ]})]
        }),

        sp(80),
        secTitle('Compliance Score Summary'),
        new Table({
          width:{ size:9000, type:WidthType.DXA }, columnWidths:[2250,2250,2250,2250],
          rows:[
            new TableRow({ children:[scoreRow('Weekly Score',weeklyScore,NAVY), scoreRow('Monthly Score',monthlyScore,NAVY), scoreRow('Quarterly Score',quarterlyScore,NAVY), scoreRow('Lifetime Score',lifetimeScore,NAVY)] }),
            new TableRow({ children:[
              new TableCell({ borders:allBdrs('E2E8F0'), columnSpan:4, width:{ size:9000, type:WidthType.DXA },
                shading:{ fill:ratingBg, type:ShadingType.CLEAR }, margins:{ top:80, bottom:80, left:200, right:200 },
                children:[new Paragraph({ alignment:AlignmentType.CENTER, children:[
                  new TextRun({ text:`Overall Rating: ${rating}`, bold:true, size:19, font:'Arial', color:ratingColor })
                ]})] })
            ]})
          ]
        }),

        sp(80),
        secTitle(`Section A — Weekly Requirements (${childCount} children in home)`),
        reqTable(weekly, REQ_NAMES),

        sp(80),
        secTitle('Section B — Monthly Requirements'),
        reqTable(monthly, REQ_NAMES),

        sp(80),
        secTitle('Section C — Quarterly Requirements'),
        reqTable(quarterly, REQ_NAMES),

        sp(80),
        secTitle('Safety & Risk Summary'),
        new Table({
          width:{ size:9000, type:WidthType.DXA }, columnWidths:[4500,4500],
          rows:[new TableRow({ children:[
            new TableCell({ borders:allBdrs('E2E8F0'), width:{ size:4500, type:WidthType.DXA },
              shading:{ fill: safetyFlag==='Yes' ? LRED : LGREEN, type:ShadingType.CLEAR }, margins:{ top:120, bottom:120, left:200, right:200 },
              children:[
                new Paragraph({ children:[new TextRun({ text:'Active Safety Flag', bold:true, size:18, font:'Arial', color:safetyFlag==='Yes'?RED:TEAL })] }),
                new Paragraph({ children:[new TextRun({ text:safetyFlag==='Yes'?'YES — Immediate action required':'None this period', bold:true, size:28, font:'Arial', color:safetyFlag==='Yes'?'791F1F':'27500A' })] }),
              ]
            }),
            new TableCell({ borders:allBdrs('E2E8F0'), width:{ size:4500, type:WidthType.DXA },
              shading:{ fill:faspStatus==='Overdue'?LRED:LGREEN, type:ShadingType.CLEAR }, margins:{ top:120, bottom:120, left:200, right:200 },
              children:[
                new Paragraph({ children:[new TextRun({ text:'FASP Status', bold:true, size:18, font:'Arial', color:faspStatus==='Overdue'?RED:TEAL })] }),
                new Paragraph({ children:[new TextRun({ text:faspStatus, bold:true, size:28, font:'Arial', color:faspStatus==='Overdue'?'791F1F':faspStatus==='Current'?'27500A':'633806' })] }),
              ]
            }),
          ]})]
        }),

        sp(80),
        secTitle('Discharge Readiness'),
        new Table({
          width:{ size:9000, type:WidthType.DXA }, columnWidths:[1800,7200],
          rows:[new TableRow({ children:[
            new TableCell({ borders:allBdrs('E2E8F0'), width:{ size:1800, type:WidthType.DXA },
              shading:{ fill:dischargeReady?LGREEN:LRED, type:ShadingType.CLEAR }, margins:{ top:160, bottom:160, left:160, right:160 }, verticalAlign:VerticalAlign.CENTER,
              children:[
                new Paragraph({ alignment:AlignmentType.CENTER, children:[new TextRun({ text:'READY', bold:true, size:16, font:'Arial', color:dischargeReady?'27500A':'791F1F' })] }),
                new Paragraph({ alignment:AlignmentType.CENTER, children:[new TextRun({ text:dischargeReady?'YES':'NO', bold:true, size:40, font:'Arial', color:dischargeReady?'27500A':'791F1F' })] }),
              ]
            }),
            new TableCell({ borders:allBdrs('E2E8F0'), width:{ size:7200, type:WidthType.DXA },
              shading:{ fill:LGRAY, type:ShadingType.CLEAR }, margins:{ top:120, bottom:120, left:200, right:200 },
              children:[
                new Paragraph({ children:[new TextRun({ text:'Discharge Notes / Clinical Rationale', bold:true, size:18, font:'Arial', color:NAVY })] }),
                sp(40),
                new Paragraph({ children:[new TextRun({ text:dischargeNotes||'No discharge notes provided.', size:18, font:'Arial', color:'222222', italics:true })] }),
              ]
            }),
          ]})]
        }),

        sp(80),
        secTitle('Supervisor Narrative & Observations'),
        new Paragraph({ spacing:{ before:60, after:80 },
          border:{ top:bdr(MGRAY), bottom:bdr(MGRAY), left:bdr(MGRAY), right:bdr(MGRAY) },
          children:[new TextRun({ text:narrative||'No narrative provided.', size:18, font:'Arial', color:'222222', italics:true })]
        }),
        sp(80),
        secTitle('E-Signature'),
        new Paragraph({ spacing:{ before:60, after:40 },
          children:[new TextRun({ text:'By signing below, the supervisor certifies that this case was reviewed in supervision, the information is accurate to the best of their knowledge, and required actions have been communicated to the case planner.', size:16, font:'Arial', color:DKGRAY, italics:true })]
        }),
        sp(60),
        sigBlock('Supervisor Signature', signature||'', 4500, 'Date', signatureDate||today, 4500),
        sp(80),
        sigBlock('Printed Name', supervisorName||'', 4500, 'License / Credential', supervisorLicense||'', 4500),
        sp(80),
        sigBlock('Title / Role', supervisorTitle||'Program Supervisor', 4500, 'Program', program, 4500),
        sp(80),
        sigBlock('Case Planner Acknowledgment', '', 4500, 'Date Acknowledged', '', 4500),
        sp(100),
        new Paragraph({
          border: { top:{ style:BorderStyle.SINGLE, size:4, color:MGRAY } },
          spacing: { before:80, after:0 },
          children:[new TextRun({ text:`DOCUMENT CERTIFICATION: This supervisory note was generated from the Prevention Services Scorecard system on ${today}. It reflects data entered for the period ending ${weekEnding}. This document is confidential and for authorized agency personnel only.`, size:15, font:'Arial', color:'888888', italics:true })]
        }),
      ]
    }]
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateSupNote };
