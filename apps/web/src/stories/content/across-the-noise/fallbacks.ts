import type { LabFallback, SceneId } from '../../types';

// Fixed teaching examples and bounded geometry. No live lab engine is imported.
export const noiseFallbacks: Record<SceneId, LabFallback> = {
  "scene-01": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Hai bản rút lời đều ngắn hơn bản gốc nhưng bỏ những chi tiết khác nhau. Bộ đếm kiểm tra giới hạn, không đánh giá điều người nhận cần biết.",
      "en": "Both shortened drafts are smaller than the original, but they omit different details. The counter checks the budget, not what the receiver needs to know."
    },
    "table": {
      "vi": {
        "headers": ["Bản (ngân sách 15 cụm ký tự)","Nguyên văn","Cụm ký tự","Byte UTF-8","Vượt ngân sách"],
        "rows": [
          ["Gốc","Mình đã đến nơi. Mọi chuyện vẫn ổn.","35","50","20"],
          ["Rút lời 1","Mình đã đến nơi.","16","23","1"],
          ["Rút lời 2","Mọi chuyện vẫn ổn.","18","26","3"]
        ]
      },
      "en": {
        "headers": ["Version (15-grapheme budget)","Exact text","Graphemes","UTF-8 bytes","Over budget"],
        "rows": [
          ["Original","I have arrived. Everything is all right.","40","40","25"],
          ["Shortened 1","I have arrived.","15","15","0"],
          ["Shortened 2","All is well.","12","12","0"]
        ]
      }
    }
  },
  "scene-02": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Với A=0, B=01 và C=1, chuỗi 01 có thể đọc thành B hoặc AC. Chỉ nhận đúng các bit chưa đủ để chọn một cách phân đoạn.",
      "en": "With A=0, B=01 and C=1, the sequence 01 can mean B or AC. Receiving the bits correctly is not enough to choose a segmentation."
    },
    "table": {
      "vi": {
        "headers": ["Ký hiệu","Mã","Cách đọc hợp lệ của 01"],
        "rows": [["A","0","AC: 0 | 1"],["B","01","B: 01"],["C","1","AC: 0 | 1"],["D","11","Không dùng trong 01"]]
      },
      "en": {
        "headers": ["Symbol","Code","Valid readings of 01"],
        "rows": [["A","0","AC: 0 | 1"],["B","01","B: 01"],["C","1","AC: 0 | 1"],["D","11","Not used in 01"]]
      }
    },
    "diagram": {
      "width": 400,
      "height": 210,
      "title": {"vi":"Hai nhánh giải mã 01","en":"Two decoding branches for 01"},
      "description": {
        "vi": "Nhánh 0 | 1 dẫn tới AC. Nhánh 01 dẫn tới B. Bảng dưới giữ đủ bốn mã.",
        "en": "Branch 0 | 1 yields AC. Branch 01 yields B. The table includes all four codes."
      },
      "lines": [
        {"points":[[180,35],[80,95],[80,165]],"style":"solid","label":{"vi":"0 → A; 1 → C","en":"0 → A; 1 → C"}},
        {"points":[[180,35],[280,95],[280,165]],"style":"solid","label":{"vi":"01 → B","en":"01 → B"}}
      ],
      "labels": [
        {"x":170,"y":25,"text":{"vi":"01","en":"01"}},
        {"x":20,"y":95,"text":{"vi":"0 → A","en":"0 → A"}},
        {"x":20,"y":140,"text":{"vi":"1 → C","en":"1 → C"}},
        {"x":65,"y":190,"text":{"vi":"AC","en":"AC"}},
        {"x":295,"y":95,"text":{"vi":"01 → B","en":"01 → B"}},
        {"x":275,"y":190,"text":{"vi":"B","en":"B"}}
      ]
    }
  },
  "scene-03": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Một dấu chấm và một dấu gạch, cách nhau ba đơn vị, có thể đọc thành E rồi T. Thu khoảng cách còn một đơn vị làm chúng thành cùng một chữ A trong bộ giải mã này.",
      "en": "A dot and a dash separated by three units can be read as E followed by T. Reducing the gap to one unit combines them into A in this decoder."
    },
    "table": {
      "vi": {
        "headers": ["Mẫu gửi","Chấm (đơn vị)","Nghỉ (đơn vị)","Gạch (đơn vị)","Đọc"],
        "rows": [["ET","1","3","3","ET"],["ET","1","1","3","A"]]
      },
      "en": {
        "headers": ["Sent sample","Dot (units)","Gap (units)","Dash (units)","Reading"],
        "rows": [["ET","1","3","3","ET"],["ET","1","1","3","A"]]
      }
    },
    "diagram": {
      "width": 440,
      "height": 250,
      "title": {"vi":"Hai dải thời gian: ET và A","en":"Two timing strips: ET and A"},
      "description": {
        "vi": "Morse quốc tế hiện đại. Mỗi đơn vị dài như nhau: chấm 1, nghỉ 3 hoặc 1, gạch 3. Ngưỡng lab: nghỉ dưới 2 cùng chữ; từ 2 đến dưới 5 ngăn chữ; từ 5 ngăn từ.",
        "en": "Modern International Morse. Equal time scale: dot 1, gap 3 or 1, dash 3. Lab thresholds: below 2 within a letter, 2 to below 5 between letters, at least 5 between words."
      },
      "lines": [
        {
          "points": [[40,85],[40,55],[90,55],[90,85],[240,85],[240,55],[390,55],[390,85]],
          "style": "solid",
          "label": {"vi":"ET: 1 / 3 / 3","en":"ET: 1 / 3 / 3"}
        },
        {
          "points": [[40,185],[40,155],[90,155],[90,185],[140,185],[140,155],[290,155],[290,185]],
          "style": "solid",
          "label": {"vi":"A: 1 / 1 / 3","en":"A: 1 / 1 / 3"}
        }
      ],
      "labels": [
        {"x":40,"y":30,"text":{"vi":"ET","en":"ET"}},
        {"x":45,"y":110,"text":{"vi":"1","en":"1"}},
        {"x":145,"y":110,"text":{"vi":"nghỉ 3","en":"gap 3"}},
        {"x":300,"y":110,"text":{"vi":"3","en":"3"}},
        {"x":40,"y":140,"text":{"vi":"A","en":"A"}},
        {"x":45,"y":210,"text":{"vi":"1","en":"1"}},
        {"x":93,"y":210,"text":{"vi":"nghỉ 1","en":"gap 1"}},
        {"x":210,"y":210,"text":{"vi":"3","en":"3"}},
        {"x":40,"y":240,"text":{"vi":"Thời gian: đơn vị quy ước","en":"Time: conventional units"}}
      ]
    }
  },
  "scene-04": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Ba tuyến giả lập có chi phí 27, 31 và 21 đơn vị. Những số này đến từ hàm chi phí công khai, không phải giá thành đặt cáp lịch sử.",
      "en": "The three fictional routes cost 27, 31 and 21 units. Those values come from the stated cost function, not historical cable-laying prices."
    },
    "table": {
      "vi": {
        "headers": ["Tuyến giả lập","L","H","D","L + 4H + 2D (đơn vị mô phỏng)","Tổng","Ngân sách","Còn thiếu"],
        "rows": [
          ["Bắc","11","2","4","11 + 8 + 8","27","28","0"],
          ["Giữa","9","5","1","9 + 20 + 2","31","28","3"],
          ["Nam","13","1","2","13 + 4 + 4","21","28","0"]
        ]
      },
      "en": {
        "headers": ["Fictional route","L","H","D","L + 4H + 2D (simulation units)","Total","Budget","Missing"],
        "rows": [
          ["North","11","2","4","11 + 8 + 8","27","28","0"],
          ["Middle","9","5","1","9 + 20 + 2","31","28","3"],
          ["South","13","1","2","13 + 4 + 4","21","28","0"]
        ]
      }
    },
    "diagram": {
      "width": 480,
      "height": 490,
      "title": {"vi":"Ba tuyến và mặt cắt giả lập","en":"Three fictional routes and profiles"},
      "description": {
        "vi": "Sơ đồ tự thiết kế. Bắc L11/H2/D4; Giữa L9/H5/D1; Nam L13/H1/D2. Độ sâu chỉ là phân loại, không phải số đo. Chi phí C=L+4H+2D.",
        "en": "Authored schematic. North L11/H2/D4; Middle L9/H5/D1; South L13/H1/D2. Depth is categorical, not measured. Cost C=L+4H+2D."
      },
      "lines": [
        {
          "points": [[40,100],[130,45],[270,55],[390,100]],
          "style": "solid",
          "label": {"vi":"Bắc: tuyến giả lập","en":"North: fictional route"}
        },
        {
          "points": [[40,100],[140,90],[260,100],[390,100]],
          "style": "dashed",
          "label": {"vi":"Giữa: tuyến giả lập","en":"Middle: fictional route"}
        },
        {
          "points": [[40,100],[140,155],[270,150],[390,100]],
          "style": "solid",
          "label": {"vi":"Nam: tuyến giả lập","en":"South: fictional route"}
        },
        {"points":[[40,260],[65,260]],"style":"solid","label":{"vi":"Bắc: đoạn 1","en":"North: segment 1"}},
        {"points":[[65,260],[90,260]],"style":"solid","label":{"vi":"Bắc: đoạn 2","en":"North: segment 2"}},
        {"points":[[90,260],[115,260]],"style":"dashed","label":{"vi":"Bắc: đoạn 3, khó","en":"North: segment 3, hard"}},
        {"points":[[115,290],[140,290]],"style":"solid","label":{"vi":"Bắc: đoạn 4, sâu","en":"North: segment 4, deep"}},
        {"points":[[115,260],[115,290]],"style":"solid","label":{"vi":"Chuyển mức sơ đồ","en":"Schematic level transition"}},
        {"points":[[140,290],[165,290]],"style":"solid","label":{"vi":"Bắc: đoạn 5, sâu","en":"North: segment 5, deep"}},
        {"points":[[165,290],[190,290]],"style":"solid","label":{"vi":"Bắc: đoạn 6, sâu","en":"North: segment 6, deep"}},
        {"points":[[190,260],[215,260]],"style":"dashed","label":{"vi":"Bắc: đoạn 7, khó","en":"North: segment 7, hard"}},
        {"points":[[190,260],[190,290]],"style":"solid","label":{"vi":"Chuyển mức sơ đồ","en":"Schematic level transition"}},
        {"points":[[215,260],[240,260]],"style":"solid","label":{"vi":"Bắc: đoạn 8","en":"North: segment 8"}},
        {"points":[[240,290],[265,290]],"style":"solid","label":{"vi":"Bắc: đoạn 9, sâu","en":"North: segment 9, deep"}},
        {"points":[[240,260],[240,290]],"style":"solid","label":{"vi":"Chuyển mức sơ đồ","en":"Schematic level transition"}},
        {"points":[[265,260],[290,260]],"style":"solid","label":{"vi":"Bắc: đoạn 10","en":"North: segment 10"}},
        {"points":[[265,260],[265,290]],"style":"solid","label":{"vi":"Chuyển mức sơ đồ","en":"Schematic level transition"}},
        {"points":[[290,260],[315,260]],"style":"solid","label":{"vi":"Bắc: đoạn 11","en":"North: segment 11"}},
        {"points":[[40,345],[65,345]],"style":"dashed","label":{"vi":"Giữa: đoạn 1, khó","en":"Middle: segment 1, hard"}},
        {"points":[[65,345],[90,345]],"style":"dashed","label":{"vi":"Giữa: đoạn 2, khó","en":"Middle: segment 2, hard"}},
        {"points":[[90,345],[115,345]],"style":"solid","label":{"vi":"Giữa: đoạn 3","en":"Middle: segment 3"}},
        {"points":[[115,345],[140,345]],"style":"dashed","label":{"vi":"Giữa: đoạn 4, khó","en":"Middle: segment 4, hard"}},
        {"points":[[140,375],[165,375]],"style":"solid","label":{"vi":"Giữa: đoạn 5, sâu","en":"Middle: segment 5, deep"}},
        {"points":[[140,345],[140,375]],"style":"solid","label":{"vi":"Chuyển mức sơ đồ","en":"Schematic level transition"}},
        {"points":[[165,345],[190,345]],"style":"solid","label":{"vi":"Giữa: đoạn 6","en":"Middle: segment 6"}},
        {"points":[[165,345],[165,375]],"style":"solid","label":{"vi":"Chuyển mức sơ đồ","en":"Schematic level transition"}},
        {"points":[[190,345],[215,345]],"style":"dashed","label":{"vi":"Giữa: đoạn 7, khó","en":"Middle: segment 7, hard"}},
        {"points":[[215,345],[240,345]],"style":"solid","label":{"vi":"Giữa: đoạn 8","en":"Middle: segment 8"}},
        {"points":[[240,345],[265,345]],"style":"dashed","label":{"vi":"Giữa: đoạn 9, khó","en":"Middle: segment 9, hard"}},
        {"points":[[40,430],[65,430]],"style":"solid","label":{"vi":"Nam: đoạn 1","en":"South: segment 1"}},
        {"points":[[65,430],[90,430]],"style":"solid","label":{"vi":"Nam: đoạn 2","en":"South: segment 2"}},
        {"points":[[90,430],[115,430]],"style":"solid","label":{"vi":"Nam: đoạn 3","en":"South: segment 3"}},
        {"points":[[115,430],[140,430]],"style":"solid","label":{"vi":"Nam: đoạn 4","en":"South: segment 4"}},
        {"points":[[140,460],[165,460]],"style":"solid","label":{"vi":"Nam: đoạn 5, sâu","en":"South: segment 5, deep"}},
        {"points":[[140,430],[140,460]],"style":"solid","label":{"vi":"Chuyển mức sơ đồ","en":"Schematic level transition"}},
        {"points":[[165,460],[190,460]],"style":"solid","label":{"vi":"Nam: đoạn 6, sâu","en":"South: segment 6, deep"}},
        {"points":[[190,430],[215,430]],"style":"solid","label":{"vi":"Nam: đoạn 7","en":"South: segment 7"}},
        {"points":[[190,430],[190,460]],"style":"solid","label":{"vi":"Chuyển mức sơ đồ","en":"Schematic level transition"}},
        {"points":[[215,430],[240,430]],"style":"dashed","label":{"vi":"Nam: đoạn 8, khó","en":"South: segment 8, hard"}},
        {"points":[[240,430],[265,430]],"style":"solid","label":{"vi":"Nam: đoạn 9","en":"South: segment 9"}},
        {"points":[[265,430],[290,430]],"style":"solid","label":{"vi":"Nam: đoạn 10","en":"South: segment 10"}},
        {"points":[[290,430],[315,430]],"style":"solid","label":{"vi":"Nam: đoạn 11","en":"South: segment 11"}},
        {"points":[[315,430],[340,430]],"style":"solid","label":{"vi":"Nam: đoạn 12","en":"South: segment 12"}},
        {"points":[[340,430],[365,430]],"style":"solid","label":{"vi":"Nam: đoạn 13","en":"South: segment 13"}}
      ],
      "labels": [
        {"x":40,"y":20,"text":{"vi":"Bản đồ giả lập, không có tỷ lệ địa lý","en":"Fictional map, no geographic scale"}},
        {"x":130,"y":40,"text":{"vi":"Bắc","en":"North"}},
        {"x":160,"y":85,"text":{"vi":"Giữa","en":"Middle"}},
        {"x":170,"y":180,"text":{"vi":"Nam","en":"South"}},
        {
          "x": 40,
          "y": 210,
          "text": {"vi":"Mỗi ô = 1 đơn vị L; thấp = sâu; nét đứt = khó","en":"Each cell = 1 L unit; lower = deep; dashed = hard"}
        },
        {"x":40,"y":245,"text":{"vi":"Bắc","en":"North"}},
        {"x":40,"y":330,"text":{"vi":"Giữa","en":"Middle"}},
        {"x":40,"y":415,"text":{"vi":"Nam","en":"South"}}
      ]
    }
  },
  "scene-05": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Hai đồ thị dùng cùng mẫu bit và cùng bộ lọc, chỉ khác thời gian giữ xung. Bảng lấy mẫu cho biết bộ nhận đã quyết định bit nào.",
      "en": "The two graphs use the same bit pattern and filter but different pulse durations. The sampling table shows the receiver’s actual bit decisions."
    },
    "table": {
      "vi": {
        "headers": ["T (đơn vị mô phỏng)","Thời điểm lấy mẫu","Biên độ đầu ra","Bit gửi","Bit nhận","Tổng lỗi / 4"],
        "rows": [
          ["4","2","-0.632121","0","0","0"],
          ["4","6","0.314028","1","1","0"],
          ["4","10","-0.357077","0","0","0"],
          ["4","14","0.351251","1","1","0"],
          ["1","0.5","-0.221199","0","0","2"],
          ["1","1.5","-0.085235","1","0","2"],
          ["1","2.5","-0.100627","0","0","2"],
          ["1","3.5","-0.012104","1","0","2"]
        ]
      },
      "en": {
        "headers": ["T (simulation units)","Sample time","Output amplitude","Sent bit","Received bit","Total errors / 4"],
        "rows": [
          ["4","2","-0.632121","0","0","0"],
          ["4","6","0.314028","1","1","0"],
          ["4","10","-0.357077","0","0","0"],
          ["4","14","0.351251","1","1","0"],
          ["1","0.5","-0.221199","0","0","2"],
          ["1","1.5","-0.085235","1","0","2"],
          ["1","2.5","-0.100627","0","0","2"],
          ["1","3.5","-0.012104","1","0","2"]
        ]
      }
    },
    "diagram": {
      "width": 500,
      "height": 385,
      "title": {"vi":"Cùng 0101, hai thời gian giữ xung","en":"The same 0101 at two pulse durations"},
      "description": {
        "vi": "Đầu vào nét liền, đầu ra nét đứt, dấu × tại mẫu. Hai bảng lấy mẫu nằm dưới. T=4 nhận 0101; T=1 nhận 0000. Cùng τ=2, không nhiễu ngẫu nhiên; trục thời gian mỗi bảng có nhãn riêng.",
        "en": "Solid input, dashed output, × at samples. Sampling tables follow. T=4 receives 0101; T=1 receives 0000. Both use τ=2 without random noise; each panel labels its own time scale."
      },
      "lines": [
        {
          "points": [[40,140],[140,140],[140,60],[240,60],[240,140],[340,140],[340,60],[440,60]],
          "style": "solid",
          "label": {"vi":"T=4: đầu vào (liền)","en":"T=4: input (solid)"}
        },
        {
          "points": [
            [40,100],
            [52.5,108.847969],
            [65,115.738774],
            [77.5,121.105338],
            [90,125.284822],
            [102.5,128.539808],
            [115,131.074794],
            [127.5,133.049042],
            [140,134.586589],
            [152.5,118.088094],
            [165,105.239053],
            [177.5,95.23221],
            [190,87.438873],
            [202.5,81.369415],
            [215,76.642517],
            [227.5,72.961206],
            [240,70.094197],
            [252.5,85.557306],
            [265,97.599987],
            [277.5,106.978837],
            [290,114.283092],
            [302.5,119.971652],
            [315,124.401907],
            [327.5,127.852193],
            [340,130.539278],
            [352.5,114.936045],
            [365,102.784235],
            [377.5,93.320396],
            [390,85.94995],
            [402.5,80.209842],
            [415,75.73944],
            [427.5,72.257889],
            [440,69.546453]
          ],
          "style": "dashed",
          "label": {"vi":"T=4: đầu ra (đứt)","en":"T=4: output (dashed)"}
        },
        {"points":[[40,100],[440,100]],"style":"dashed","label":{"vi":"Ngưỡng 0","en":"Threshold 0"}},
        {
          "points": [[87,122.284822],[93,128.28482200000002],[90,125.284822],[87,128.28482200000002],[93,122.284822]],
          "style": "solid",
          "label": {"vi":"Mẫu tại t=2","en":"Sample at t=2"}
        },
        {
          "points": [[187,84.438873],[193,90.438873],[190,87.438873],[187,90.438873],[193,84.438873]],
          "style": "solid",
          "label": {"vi":"Mẫu tại t=6","en":"Sample at t=6"}
        },
        {
          "points": [[287,111.283092],[293,117.283092],[290,114.283092],[287,117.283092],[293,111.283092]],
          "style": "solid",
          "label": {"vi":"Mẫu tại t=10","en":"Sample at t=10"}
        },
        {
          "points": [[387,82.94995],[393,88.94995],[390,85.94995],[387,88.94995],[393,82.94995]],
          "style": "solid",
          "label": {"vi":"Mẫu tại t=14","en":"Sample at t=14"}
        },
        {
          "points": [[40,330],[140,330],[140,250],[240,250],[240,330],[340,330],[340,250],[440,250]],
          "style": "solid",
          "label": {"vi":"T=1: đầu vào (liền)","en":"T=1: input (solid)"}
        },
        {
          "points": [
            [40,290],
            [52.5,292.423477],
            [65,294.700124],
            [77.5,296.838835],
            [90,298.847969],
            [102.5,300.735375],
            [115,302.508429],
            [127.5,304.174059],
            [140,305.738774],
            [152.5,302.361732],
            [165,299.189295],
            [177.5,296.209066],
            [190,293.409401],
            [202.5,290.779358],
            [215,288.308662],
            [227.5,285.987657],
            [240,283.807275],
            [252.5,286.605951],
            [265,289.235063],
            [277.5,291.704886],
            [290,294.02507],
            [302.5,296.204681],
            [315,298.252235],
            [327.5,300.175735],
            [340,301.982696],
            [352.5,298.833224],
            [365,295.874568],
            [377.5,293.095169],
            [390,290.484164],
            [402.5,288.031353],
            [415,285.72715],
            [427.5,283.562551],
            [440,281.529099]
          ],
          "style": "dashed",
          "label": {"vi":"T=1: đầu ra (đứt)","en":"T=1: output (dashed)"}
        },
        {"points":[[40,290],[440,290]],"style":"dashed","label":{"vi":"Ngưỡng 0","en":"Threshold 0"}},
        {
          "points": [[87,295.847969],[93,301.847969],[90,298.847969],[87,301.847969],[93,295.847969]],
          "style": "solid",
          "label": {"vi":"Mẫu tại t=0.5","en":"Sample at t=0.5"}
        },
        {
          "points": [[187,290.409401],[193,296.409401],[190,293.409401],[187,296.409401],[193,290.409401]],
          "style": "solid",
          "label": {"vi":"Mẫu tại t=1.5","en":"Sample at t=1.5"}
        },
        {
          "points": [[287,291.02507],[293,297.02507],[290,294.02507],[287,297.02507],[293,291.02507]],
          "style": "solid",
          "label": {"vi":"Mẫu tại t=2.5","en":"Sample at t=2.5"}
        },
        {
          "points": [[387,287.484164],[393,293.484164],[390,290.484164],[387,293.484164],[393,287.484164]],
          "style": "solid",
          "label": {"vi":"Mẫu tại t=3.5","en":"Sample at t=3.5"}
        }
      ],
      "labels": [
        {"x":85,"y":165,"text":{"vi":"2","en":"2"}},
        {"x":185,"y":165,"text":{"vi":"6","en":"6"}},
        {"x":285,"y":165,"text":{"vi":"10","en":"10"}},
        {"x":385,"y":165,"text":{"vi":"14","en":"14"}},
        {
          "x": 40,
          "y": 35,
          "text": {"vi":"T=4; đầu vào liền, đầu ra đứt; × lấy mẫu","en":"T=4; input solid, output dashed; × sample"}
        },
        {"x":12,"y":105,"text":{"vi":"0","en":"0"}},
        {"x":5,"y":62,"text":{"vi":"+1","en":"+1"}},
        {"x":5,"y":145,"text":{"vi":"−1","en":"−1"}},
        {
          "x": 40,
          "y": 188,
          "text": {"vi":"t: đơn vị mô phỏng; τ=2, lấy mẫu 0.5T","en":"t: simulation units; τ=2, sample at 0.5T"}
        },
        {"x":85,"y":355,"text":{"vi":"0.5","en":"0.5"}},
        {"x":185,"y":355,"text":{"vi":"1.5","en":"1.5"}},
        {"x":285,"y":355,"text":{"vi":"2.5","en":"2.5"}},
        {"x":385,"y":355,"text":{"vi":"3.5","en":"3.5"}},
        {
          "x": 40,
          "y": 225,
          "text": {"vi":"T=1; đầu vào liền, đầu ra đứt; × lấy mẫu","en":"T=1; input solid, output dashed; × sample"}
        },
        {"x":12,"y":295,"text":{"vi":"0","en":"0"}},
        {"x":5,"y":252,"text":{"vi":"+1","en":"+1"}},
        {"x":5,"y":335,"text":{"vi":"−1","en":"−1"}},
        {
          "x": 40,
          "y": 378,
          "text": {"vi":"t: đơn vị mô phỏng; τ=2, lấy mẫu 0.5T","en":"t: simulation units; τ=2, sample at 0.5T"}
        }
      ]
    }
  },
  "scene-06": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Ví dụ chỉ ra một vị trí bit bị lật và byte nhận tương ứng. Một byte đổi có thể vẫn đọc được hoặc làm hỏng cách giải mã văn bản.",
      "en": "The example marks one flipped bit and the corresponding received byte. A changed byte may remain readable or invalidate the text decoding."
    },
    "table": {
      "vi": {
        "headers": ["Gốc","Bit lật (vị trí từ 1)","Byte nhận","Bit nhận","UTF-8 nghiêm ngặt","Bit đổi / 8","BER","Khớp byte"],
        "rows": [
          ["A / 0x41 / 01000001","1","0xC1","11000001","Không hợp lệ","1","0.125","Không"],
          ["A / 0x41 / 01000001","8","0x40","01000000","@","1","0.125","Không"]
        ]
      },
      "en": {
        "headers": ["Original","Flipped bit (1-based)","Received byte","Received bits","Strict UTF-8","Changed bits / 8","BER","Byte exact"],
        "rows": [
          ["A / 0x41 / 01000001","1","0xC1","11000001","Invalid","1","0.125","No"],
          ["A / 0x41 / 01000001","8","0x40","01000000","@","1","0.125","No"]
        ]
      }
    }
  },
  "scene-07": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Nguồn luôn cho một ký hiệu có entropy bằng không; nguồn bốn ký hiệu ngang nhau có entropy hai bit trên ký hiệu. Đây không phải điểm đo ý nghĩa.",
      "en": "A source that always produces one symbol has zero entropy; four equally likely symbols have two bits per symbol. This is not a score for meaning."
    },
    "table": {
      "vi": {
        "headers": ["Trọng số A,B,C,D","Xác suất A,B,C,D","Đóng góp A,B,C,D (bit/ký hiệu)","H (bit/ký hiệu nguồn)"],
        "rows": [["1,0,0,0","1,0,0,0","0,0,0,0","0"],["1,1,1,1","0.25,0.25,0.25,0.25","0.5,0.5,0.5,0.5","2"]]
      },
      "en": {
        "headers": ["Weights A,B,C,D","Probabilities A,B,C,D","Contributions A,B,C,D (bits/symbol)","H (bits/source symbol)"],
        "rows": [["1,0,0,0","1,0,0,0","0,0,0,0","0"],["1,1,1,1","0.25,0.25,0.25,0.25","0.5,0.5,0.5,0.5","2"]]
      }
    }
  },
  "scene-08": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Trong định dạng dạy học, AAAA cần bốn bit payload nhưng tổng gói là 96 bit khi cộng header và phần đệm. Giải mã vẫn trả lại đủ bốn byte gốc.",
      "en": "In the teaching format, AAAA needs four payload bits but 96 total bits after the header and padding. Decoding still returns all four original bytes."
    },
    "table": {
      "vi": {
        "headers": ["Mẫu byte","Mã (độ dài)","Gốc (bit)","Payload (bit)","Header (bit)","Đệm (bit)","Tổng (bit)","Giải mã byte"],
        "rows": [
          ["AAAA","0x41: 0 (1)","32","4","88","4","96","65,65,65,65"],
          ["ABCD","0x41: 00 (2); 0x42: 01 (2); 0x43: 10 (2); 0x44: 11 (2)","32","8","160","0","168","65,66,67,68"]
        ]
      },
      "en": {
        "headers": ["Byte sample","Codes (length)","Raw (bits)","Payload (bits)","Header (bits)","Padding (bits)","Total (bits)","Decoded bytes"],
        "rows": [
          ["AAAA","0x41: 0 (1)","32","4","88","4","96","65,65,65,65"],
          ["ABCD","0x41: 00 (2); 0x42: 01 (2); 0x43: 10 (2); 0x44: 11 (2)","32","8","160","0","168","65,66,67,68"]
        ]
      }
    },
    "diagram": {
      "width": 450,
      "height": 260,
      "title": {"vi":"Cây bốn byte ABCD","en":"Four-byte ABCD tree"},
      "description": {
        "vi": "Mỗi byte có tần suất 1. Ghép A+B và C+D thành hai nhóm 2, rồi nhóm 4. Nhánh trái 0, phải 1. Cây này thuộc gói ABCD 168 bit, không phải gói AAAA 96 bit.",
        "en": "Each byte has frequency 1. Merge A+B and C+D into groups of 2, then 4. Left edge 0, right edge 1. This tree belongs to the 168-bit ABCD packet, not the 96-bit AAAA packet."
      },
      "lines": [
        {"points":[[215,35],[115,100]],"style":"solid","label":{"vi":"0: AB","en":"0: AB"}},
        {"points":[[215,35],[315,100]],"style":"solid","label":{"vi":"1: CD","en":"1: CD"}},
        {"points":[[115,100],[55,180]],"style":"solid","label":{"vi":"0: A","en":"0: A"}},
        {"points":[[115,100],[175,180]],"style":"solid","label":{"vi":"1: B","en":"1: B"}},
        {"points":[[315,100],[265,180]],"style":"solid","label":{"vi":"0: C","en":"0: C"}},
        {"points":[[315,100],[395,180]],"style":"solid","label":{"vi":"1: D","en":"1: D"}}
      ],
      "labels": [
        {"x":192,"y":25,"text":{"vi":"ABCD: 4","en":"ABCD: 4"}},
        {"x":90,"y":90,"text":{"vi":"AB: 2","en":"AB: 2"}},
        {"x":300,"y":90,"text":{"vi":"CD: 2","en":"CD: 2"}},
        {"x":142,"y":65,"text":{"vi":"0","en":"0"}},
        {"x":275,"y":65,"text":{"vi":"1","en":"1"}},
        {"x":70,"y":140,"text":{"vi":"0","en":"0"}},
        {"x":150,"y":140,"text":{"vi":"1","en":"1"}},
        {"x":275,"y":140,"text":{"vi":"0","en":"0"}},
        {"x":355,"y":140,"text":{"vi":"1","en":"1"}},
        {"x":20,"y":205,"text":{"vi":"0x41 A: 1","en":"0x41 A: 1"}},
        {"x":140,"y":205,"text":{"vi":"0x42 B: 1","en":"0x42 B: 1"}},
        {"x":235,"y":205,"text":{"vi":"0x43 C: 1","en":"0x43 C: 1"}},
        {"x":355,"y":205,"text":{"vi":"0x44 D: 1","en":"0x44 D: 1"}},
        {"x":40,"y":230,"text":{"vi":"00","en":"00"}},
        {"x":165,"y":230,"text":{"vi":"01","en":"01"}},
        {"x":260,"y":230,"text":{"vi":"10","en":"10"}},
        {"x":385,"y":230,"text":{"vi":"11","en":"11"}}
      ]
    }
  },
  "scene-09": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Khối 000 thành 100 vẫn được biểu quyết về 0. Thành 110 thì biểu quyết sai về 1. Số bản sao không loại bỏ giới hạn của mô hình lỗi.",
      "en": "A block changing from 000 to 100 still votes to 0. Changing to 110 makes it vote incorrectly to 1. More copies do not remove the error model’s limits."
    },
    "table": {
      "vi": {
        "headers": ["Bit gốc","Khối gửi","Khối nhận","Bit lật","Biểu quyết","Khớp","Số lần dùng kênh"],
        "rows": [["0","0","1","1","1","Không","1"],["0","000","100","1","0","Có","3"],["0","000","110","2","1","Không","3"]]
      },
      "en": {
        "headers": ["Source bit","Sent block","Received block","Flipped bits","Decision","Exact","Channel uses"],
        "rows": [["0","0","1","1","1","No","1"],["0","000","100","1","0","Yes","3"],["0","000","110","2","1","No","3"]]
      }
    }
  },
  "scene-10": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Khối dữ liệu 1011 được bảo vệ thành 01100110 theo thứ tự bit đã ghi. Một bit lật có thể sửa; hai bit lật phải bị phát hiện và từ chối. Nhóm kiểm tra vị trí (từ 1): p1={1,3,5,7}, p2={2,3,6,7}, p4={4,5,6,7}, p0={1,2,3,4,5,6,7,8}; parity chẵn. Bảng chỉ có 0, 1 hoặc 2 lỗi; không bảo đảm cho nhiều lỗi hơn.",
      "en": "Data block 1011 becomes 01100110 with the stated bit order. One flipped bit can be repaired; two flipped bits must be detected and rejected. Check groups (1-based): p1={1,3,5,7}, p2={2,3,6,7}, p4={4,5,6,7}, p0={1,2,3,4,5,6,7,8}; even parity. The table contains only 0, 1 or 2 errors; more errors are not guaranteed."
    },
    "table": {
      "vi": {
        "headers": ["Dữ liệu","Mã gửi p1,p2,d1,p4,d2,d3,d4,p0","Vị trí lật (từ 1)","Mã nhận","Syndrome","Parity tổng","Quyết định","Dữ liệu khôi phục"],
        "rows": [
          ["1011","01100110","Không","01100110","0","0","Không báo lỗi","1011"],
          ["1011","01100110","1","11100110","1","1","Sửa vị trí 1","1011"],
          ["1011","01100110","1,2","10100110","3","0","Phát hiện hai lỗi; từ chối","Không nhận"]
        ]
      },
      "en": {
        "headers": ["Data","Sent p1,p2,d1,p4,d2,d3,d4,p0","Flipped positions (1-based)","Received word","Syndrome","Overall parity","Decision","Recovered data"],
        "rows": [
          ["1011","01100110","None","01100110","0","0","No alarm","1011"],
          ["1011","01100110","1","11100110","1","1","Correct position 1","1011"],
          ["1011","01100110","1,2","10100110","3","0","Two errors detected; reject","Not accepted"]
        ]
      }
    }
  },
  "scene-11": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Ba mã dùng lượng kênh khác nhau cho cùng dữ liệu. Bảng ví dụ phân biệt rate, overhead và kết quả; đường capacity không bảo đảm mã ngắn đạt độ tin cậy mong muốn. Ví dụ riêng: 64 byte A (UTF-8 chưa nén), p=0, seed=20260905, ngân sách 1024 lần dùng kênh. Sức chứa bảng là floor(B/n)×k, không phải Shannon capacity; không cắt thông điệp.",
      "en": "The three codes use different channel resources for the same data. The example separates rate, overhead and outcomes; the capacity curve does not guarantee a short code’s reliability. Separate example: 64 A bytes (uncompressed UTF-8), p=0, seed=20260905, budget 1024 channel uses. Table capacity is floor(B/n)×k, not Shannon capacity; the message is not truncated."
    },
    "table": {
      "vi": {
        "headers": ["Mã","k","n","Rate","Dữ liệu (bit)","Thêm (bit)","Cần dùng kênh","Ngân sách","Sức chứa (bit)","Còn thiếu","Ví dụ p=0"],
        "rows": [
          ["raw","1","1","1","512","0","512","1024","1024","0","Khớp"],
          ["repeat3","1","3","1/3","512","1024","1536","1024","341","512","Không chạy: thiếu ngân sách"],
          ["secded","4","8","1/2","512","512","1024","1024","512","0","Khớp"]
        ]
      },
      "en": {
        "headers": ["Code","k","n","Rate","Payload (bits)","Added (bits)","Required uses","Budget","Payload capacity (bits)","Missing uses","p=0 example"],
        "rows": [
          ["raw","1","1","1","512","0","512","1024","1024","0","Exact"],
          ["repeat3","1","3","1/3","512","1024","1536","1024","341","512","Not run: insufficient budget"],
          ["secded","4","8","1/2","512","512","1024","1024","512","0","Exact"]
        ]
      }
    }
  },
  "scene-12": {
    "diagramLabel": {"vi":"Ví dụ tĩnh; đây không phải kết quả lần thử của bạn","en":"Static example; this is not your experiment result"},
    "explanation": {
      "vi": "Cùng một câu mẫu được đặt trong ba bối cảnh hư cấu. Đổi bối cảnh không đổi byte. Bài thử không chấm cách hiểu nào là đúng. Đây là bản sao tĩnh của câu mẫu, không phải biên nhận truyền của lượt thử hiện tại.",
      "en": "The same example sentence appears in three fictional contexts. Changing context does not change its bytes. The experiment does not grade one interpretation as correct. This is a static copy of the example, not a transmission receipt for the current experiment."
    },
    "table": {
      "vi": {
        "headers": ["Bối cảnh hư cấu","Câu mẫu gửi","Bản sao tĩnh của câu mẫu"],
        "rows": [
          ["cuộc hẹn thường ngày","Mình đã đến nơi. Mọi chuyện vẫn ổn.","Mình đã đến nơi. Mọi chuyện vẫn ổn."],
          ["hai người vừa bất đồng","Mình đã đến nơi. Mọi chuyện vẫn ổn.","Mình đã đến nơi. Mọi chuyện vẫn ổn."],
          ["người nhận thiếu câu trước","Mình đã đến nơi. Mọi chuyện vẫn ổn.","Mình đã đến nơi. Mọi chuyện vẫn ổn."]
        ]
      },
      "en": {
        "headers": ["Fictional context","Example sent text","Static copy of the example"],
        "rows": [
          ["an ordinary meeting","I have arrived. Everything is all right.","I have arrived. Everything is all right."],
          ["after a disagreement","I have arrived. Everything is all right.","I have arrived. Everything is all right."],
          ["the receiver missed the preceding message","I have arrived. Everything is all right.","I have arrived. Everything is all right."]
        ]
      }
    }
  }
};
