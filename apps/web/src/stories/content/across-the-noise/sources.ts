import type { SourceEntry } from '../../types';

// Access date and scope follow the controller’s primary-source audit of 2026-09-05.
// Access limitations are disclosed in the notes; no source image is reused.
export const noiseSources: SourceEntry[] = [
  {
    "id": "morse-tape",
    "kind": "artifact",
    "title": "Library of Congress — băng điện báo 24/05/1844",
    "authorsOrInstitution": "Library of Congress",
    "year": "1844",
    "url": "https://www.loc.gov/item/mcc.019/",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Hiện vật và vai trò Morse, Vail, Ellsworth. Metadata chính thức đã được tìm thấy ngày 05/09/2026; trang trực tiếp trả 403. Không khẳng định điện báo đầu tiên trên thế giới.",
      "en": "The artifact and the roles of Morse, Vail and Ellsworth. Official indexed metadata was retrieved on 2026-09-05; the direct page returned 403. No claim to the world’s first telegram."
    }
  },
  {
    "id": "morse-archive",
    "kind": "archive",
    "title": "Library of Congress — Invention of the Telegraph",
    "authorsOrInstitution": "Library of Congress",
    "year": "n.d.",
    "url": "https://www.loc.gov/collections/samuel-morse-papers/articles-and-essays/collection-highlights/invention-of-the-telegraph/",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Tư liệu về truyền và đọc mã, người vận hành và hợp tác. Nội dung chính thức được lập chỉ mục đã được kiểm tra ngày 05/09/2026; truy cập trực tiếp trả 403. Không chứng minh các nhân vật hư cấu.",
      "en": "Transmission, reading codes, operators and collaboration. Official indexed content was checked on 2026-09-05; direct access returned 403. It does not substantiate the fictional characters."
    }
  },
  {
    "id": "itu-morse",
    "kind": "report",
    "title": "ITU-R M.1677-1",
    "authorsOrInstitution": "International Telecommunication Union",
    "year": "2009",
    "url": "https://www.itu.int/dms_pubrec/itu-r/rec/m/R-REC-M.1677-1-200910-I%21%21PDF-E.pdf",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "M.1677-1, trang 3–4: bảng Morse và thời gian dấu/khoảng nghỉ 1/3/7 của quy ước quốc tế hiện đại; không phải giao thức năm 1844. Ngưỡng bộ giải mã là lựa chọn của lab.",
      "en": "M.1677-1, pages 3–4: the modern International Morse alphabet and 1/3/7 timing; not an 1844 protocol. Decoder thresholds are teaching choices."
    }
  },
  {
    "id": "cable-history",
    "kind": "report",
    "title": "Science Museum — Sending messages across the Atlantic",
    "authorsOrInstitution": "Chloe Vince / Science Museum",
    "year": "2014",
    "url": "https://blog.sciencemuseum.org.uk/sending-messages-across-the-atlantic-156-years-on-from-the-first-transatlantic-cable/",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Bài ngày 15/08/2014: nỗ lực cáp 1858 thất bại trong một tháng và tuyến thành công 1866. Chi phí tuyến giả lập không phải số đo lịch sử.",
      "en": "The 2014-08-15 article documents the 1858 cable failing within a month and the successful 1866 connection. Fictional route costs are not historical measurements."
    }
  },
  {
    "id": "cable-object",
    "kind": "artifact",
    "title": "Science Museum Group — deep-sea cable sample",
    "authorsOrInstitution": "Science Museum Group",
    "year": "1857–1858",
    "url": "https://collection.sciencemuseumgroup.org.uk/objects/co33448/sample-of-deep-sea-section-of-first-transatlantic-cable-1857-1858",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Hiện vật cáp biển sâu, vật liệu, sản xuất Greenwich và phối hợp hai tàu. Không dùng ảnh hiện vật làm tranh của số này hoặc suy ra hệ số bộ lọc.",
      "en": "Deep-sea cable materials, Greenwich manufacture and two-ship coordination. Its photograph is not used as edition artwork or evidence for the filter coefficients."
    }
  },
  {
    "id": "cable-workers",
    "kind": "artifact",
    "title": "The Met — Dudley, reels at Greenwich",
    "authorsOrInstitution": "Robert Charles Dudley / The Metropolitan Museum of Art",
    "year": "1865–1866",
    "url": "https://www.metmuseum.org/art/collection/search/383811",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Màu nước, graphite và gouache: cuộn vật liệu tại Greenwich và bối cảnh lao động tập thể. Tham khảo bối cảnh, không sao chép tác phẩm làm illustration.",
      "en": "Watercolor, graphite and gouache: material reels at Greenwich and collective work. Contextual evidence; the work is not copied as an illustration."
    }
  },
  {
    "id": "shannon-1948",
    "kind": "paper",
    "title": "Shannon — A Mathematical Theory of Communication",
    "authorsOrInstitution": "Claude E. Shannon",
    "year": "1948",
    "url": "https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Mở đầu tách ngữ nghĩa khỏi bài toán kỹ thuật; trang 9–10 về entropy, 21–22 về capacity và định lý tiệm cận. Không bảo đảm kết quả mã ngắn hoặc đo ý nghĩa.",
      "en": "The opening separates semantics from engineering; pages 9–10 discuss entropy and pages 21–22 capacity and asymptotic coding. No guarantee for short codes or measure of meaning."
    }
  },
  {
    "id": "mit-isi",
    "kind": "report",
    "title": "MIT 6.02 — LTI channel and intersymbol interference",
    "authorsOrInstitution": "MIT OpenCourseWare, 6.02",
    "year": "2012",
    "url": "https://ocw.mit.edu/courses/6-02-introduction-to-eecs-ii-digital-communication-systems-fall-2012/resources/mit6_02f12_lec11/",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Lecture 11, slide 2–4/7/13: lấy mẫu, ngưỡng, đáp ứng LTI và giản lược kênh. Bộ lọc một cực và thông số của lab là mô hình dạy học, không phải phép đo cáp lịch sử.",
      "en": "Lecture 11, slides 2–4/7/13: sampling, thresholds, LTI response and channel simplifications. The lab’s one-pole filter and parameters are teaching choices, not historic cable measurements."
    }
  },
  {
    "id": "huffman-1952",
    "kind": "paper",
    "title": "Huffman — Minimum-Redundancy Codes",
    "authorsOrInstitution": "David A. Huffman",
    "year": "1952",
    "url": "https://www.cse.iitd.ac.in/~pkalra/siv864/huffman_1952.pdf",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Bản scan 4 trang truy cập được nhưng ảnh thuật toán chưa xem được. Thuật toán được kiểm qua phần bài gốc in lại, trang in 11–13: https://web.stanford.edu/class/archive/cs/cs106b/cs106b.1262/lectures/24-huffman/HuffmanStory.pdf . Quy tắc phá hoà và header là lựa chọn của lab.",
      "en": "The four-page scan was accessible but its algorithm image could not be inspected. Verified against the reprinted primary paper, printed pages 11–13: https://web.stanford.edu/class/archive/cs/cs106b/cs106b.1262/lectures/24-huffman/HuffmanStory.pdf . The tie-break and header are lab choices."
    }
  },
  {
    "id": "hamming-1950",
    "kind": "paper",
    "title": "Hamming — Error Detecting and Error Correcting Codes",
    "authorsOrInstitution": "Richard W. Hamming",
    "year": "1950",
    "url": "https://ineffectivetheory.com/edu/papers/hamming-codes-1950.pdf",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Trang 6–7, mục 4 thêm parity tổng: sửa một lỗi và phát hiện hai lỗi; trang 8–9 về khoảng cách tối thiểu. Không mở rộng bảo đảm sang ba lỗi trở lên.",
      "en": "Pages 6–7, section 4 adds overall parity: single-error correction and double-error detection; pages 8–9 discuss minimum distance. No guarantee for three or more flips."
    }
  },
  {
    "id": "mit-code",
    "kind": "report",
    "title": "MIT 16.36 — Error-correcting codes",
    "authorsOrInstitution": "Eytan Modiano / MIT OpenCourseWare, 16.36",
    "year": "2009",
    "url": "https://ocw.mit.edu/courses/16-36-communication-systems-engineering-spring-2009/a49d9e2954b440def3794fe73e79756c_MIT16_36s09_lec13_14.pdf",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Slide 3–6 về lặp, biểu quyết, rate và BSC capacity; 9 về tiệm cận; 20–21/25 về syndrome và lỗi không phát hiện/sửa sai. SECDED mở rộng dẫn riêng Hamming 1950.",
      "en": "Slides 3–6 cover repetition, majority vote, rate and BSC capacity; 9 covers asymptotics; 20–21/25 cover syndromes and undetected/miscorrected errors. Extended SECDED is supported separately by Hamming 1950."
    }
  },
  {
    "id": "ibm-repetition",
    "kind": "report",
    "title": "IBM — Classical repetition codes",
    "authorsOrInstitution": "IBM Quantum Learning",
    "year": "n.d.",
    "url": "https://quantum.cloud.ibm.com/learning/en/courses/foundations-of-quantum-error-correction/correcting-quantum-errors/repetition-codes",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Chỉ phần mã lặp CỔ ĐIỂN: lật bit độc lập và xác suất biểu quyết sai 3p²−2p³. Không áp công thức cho burst hoặc đưa lập luận lượng tử vào lab.",
      "en": "Only the CLASSICAL section: independent flips and majority-error probability 3p²−2p³. The formula does not apply to bursts; quantum arguments are not imported into the lab."
    }
  },
  {
    "id": "mit-capacity",
    "kind": "report",
    "title": "MIT 18.200 — Lecture 18",
    "authorsOrInstitution": "MIT OpenCourseWare, 18.200",
    "year": "2024",
    "url": "https://ocw.mit.edu/courses/18-200-principles-of-discrete-applied-mathematics-spring-2024/162Kg6KxXkKjTsu27kUKYXPyN86Sqc14s_transcript.pdf",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "Bản chép bài giảng, trang 4–5/12–13: BSC capacity 1−H₂(p), bằng 0 tại p=0.5 và giới hạn tiệm cận. Không dùng lỗi chép p=1 tại ví dụ p=0.5; không bảo đảm batch 200 lần.",
      "en": "Transcript pages 4–5/12–13: BSC capacity 1−H₂(p), zero at p=0.5 and the asymptotic limit. The isolated p=1 transcript typo in the p=0.5 example is not used; no guarantee for a 200-trial batch."
    }
  },
  {
    "id": "unicode-segmentation",
    "kind": "report",
    "title": "Unicode UAX #29",
    "authorsOrInstitution": "Unicode Consortium",
    "year": "Living standard",
    "url": "https://www.unicode.org/reports/tr29/",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "UAX #29, mục 3: grapheme là xấp xỉ tính được của ký tự người đọc nhận thấy; có thể gồm nhiều code point. Không đồng nhất grapheme với byte.",
      "en": "UAX #29, section 3: grapheme clusters approximate user-perceived characters and may contain several code points. Graphemes are not bytes."
    }
  },
  {
    "id": "unicode-normalization",
    "kind": "report",
    "title": "Unicode UAX #15",
    "authorsOrInstitution": "Unicode Consortium",
    "year": "Living standard",
    "url": "https://unicode.org/reports/tr15/",
    "accessedAt": "2026-09-05",
    "note": {
      "vi": "UAX #15, mục 1.1/10: chuỗi tương đương chuẩn tắc có thể khác biểu diễn nhị phân. Giữ nguyên byte và không chuẩn hoá là lựa chọn của thí nghiệm này.",
      "en": "UAX #15, sections 1.1/10: canonically equivalent strings may have different binary representations. Preserving bytes without normalization is this experiment’s explicit choice."
    }
  }
];
