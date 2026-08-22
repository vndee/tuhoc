import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MAX_UNCOMPRESSED_BYTES } from './validate';
import { UnsafeArchiveError, packZip, unpackZip } from './zip';

// Ngân sách thời gian cho CẢ TỆP, không rắc `{ timeout }` lên từng ca.
//
// Mọi ca ở đây dựng fixture cỡ MiB — bom nén theo dòng, hai payload 20 MiB đóng
// ở level 9 — và đó là chi phí DỰNG, không phải một khẳng định nào. Máy rảnh:
// 0,1–1,5 s mỗi ca. Đo dưới tải (32 spinner; cache lạnh, load avg tới 123) thì
// cùng những ca đó phồng 10–13 lần, và ca "kho KHÔNG có mục lục" — 1,0 s khi
// rảnh — ĐỎ 25/26 lần vì chạm mặc định 5.000 ms của vitest, trong khi rảnh thì
// 0/30, mã không đổi. Đó là cổng đỏ giả, không phải hồi quy.
//
// Đặt một chỗ cho cả tệp là có chủ ý: cách kia — thêm `{ timeout }` vào ca vừa
// đỏ — chính là cách quả bom 128 MiB ở dòng dưới có ngân sách còn ca anh em
// dựng CÙNG quả bom thì không. Ca tiếp theo ai đó viết cũng sẽ quên.
vi.setConfig({ testTimeout: 120_000 });

const enc = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// The three cases from the task brief, verbatim.
// ---------------------------------------------------------------------------

it('vòng tròn: pack rồi unpack ra đúng nội dung cũ', () => {
  const files = new Map([['manifest.json', new TextEncoder().encode('{}')]]);
  expect([...unpackZip(packZip(files))]).toEqual([...files]);
});

it('mục có ../ bị NÉM, không phải bị bỏ qua im lặng', () => {
  const evil = packZip(new Map([['../thoat.txt', new Uint8Array([1])]]));
  expect(() => unpackZip(evil)).toThrow(UnsafeArchiveError);
});

it('zip bomb: nén nhỏ nhưng giải nén vượt trần → NÉM trước khi cấp phát hết bộ nhớ', () => {
  const bomb = packZip(new Map([['big.txt', new Uint8Array(21 * 1024 * 1024)]]));
  expect(bomb.byteLength).toBeLessThan(1024 * 1024); // nén rất nhỏ
  expect(() => unpackZip(bomb)).toThrow(/TOO_LARGE|vượt trần/);
});

// ---------------------------------------------------------------------------
// Trần giải nén — ca quan trọng nhất của task này, mổ theo từng trục.
//
// `MAX_UNCOMPRESSED_BYTES` sống trong `validate.ts`, nhưng `validatePackage`
// nhận vào một Map ĐÃ giải nén: tới lúc luật đó chạy thì bom đã nổ rồi. Chốt
// thật nằm ở đây, và nó phải nằm TRONG vòng giải nén.
// ---------------------------------------------------------------------------

describe('trần giải nén được áp TRONG lúc giải nén', () => {
  it('cộng dồn qua NHIỀU mục, không phải trần cho từng mục', () => {
    // Mỗi mục 6 MiB — dưới trần. Bốn mục là 24 MiB — trên trần. Một cái trần
    // áp cho từng mục sẽ để lọt gói này.
    const six = 6 * 1024 * 1024;
    const files = new Map<string, Uint8Array>();
    for (let i = 0; i < 4; i++) files.set(`e${i}.bin`, new Uint8Array(six));
    const err = catchUnsafe(() => unpackZip(packZip(files)));
    expect(err.code).toBe('TOO_LARGE');
    // …và ném ở ĐÚNG chỗ phần cộng dồn nói nó phải ném. `e3.bin` khai 6 MiB
    // trong khi ngân sách CÒN LẠI là 2 MiB, nên đường tắt "từ chối theo kích
    // thước khai báo" phải trừ đi phần đã đọc: `claimed > MAX - total`. Bỏ
    // `- total` đi thì gói này VẪN bị từ chối — phép đếm byte thật vẫn cứu —
    // nhưng bởi một luật khác, ở một mục khác, sau khi đã bung thêm 6 MiB.
    // Chấm `code` thôi thì không thấy khác biệt đó; chấm chỗ ném thì thấy.
    expect(err.entry).toBe('e3.bin');
    expect(err.message).toContain(`declares ${six} bytes`);
  });

  it('trần + 1 byte KHI KHÔNG AI KHAI KÍCH THƯỚC: chỉ còn phép cộng dồn đỡ', () => {
    // Biên trên của phép cộng dồn, đo bằng kho KHÔNG khai kích thước.
    //
    // Ca "ĐỐI CHỨNG: đúng trần thì QUA, trần + 1 thì NÉM" ở dưới dùng `packZip`,
    // mà `packZip` luôn ghi kích thước thật vào local header — nên CẢ HAI vế của
    // nó được quyết bởi đường tắt `claimed`, không phải bởi `total`. Hệ quả đo
    // được: nới trần thêm 4 KiB (`total > MAX + 4096`) thì không một test nào
    // đỏ. `streamedBomb` dùng data descriptor nên `claimed === undefined`, và
    // đường duy nhất còn lại là phép đếm byte thật.
    const over = catchUnsafe(() => unpackZip(streamedBomb('x.bin', MAX_UNCOMPRESSED_BYTES + 1)));
    expect(over.code).toBe('TOO_LARGE');
    expect(over.message).toContain('decompressed size passed');
    // …và ĐỐI CHỨNG ở đúng biên đó: một byte ít hơn thì đọc trọn vẹn. Không có
    // dòng này thì `total >= MAX` cũng xanh.
    expect(unpackZip(streamedBomb('x.bin', MAX_UNCOMPRESSED_BYTES)).get('x.bin')?.byteLength)
      .toBe(MAX_UNCOMPRESSED_BYTES);
  });

  it('ĐỐI CHỨNG: đúng trần thì QUA, trần + 1 byte thì NÉM', () => {
    // Trần là một con số, không phải một quan hệ. Nếu ai đó đổi `>` thành `>=`
    // hoặc trừ đi một byte, dòng đầu đỏ; nếu ai đó bỏ hẳn chốt, dòng sau đỏ.
    const at = new Uint8Array(MAX_UNCOMPRESSED_BYTES);
    expect(unpackZip(packZip(new Map([['x.bin', at]]))).get('x.bin')?.byteLength)
      .toBe(MAX_UNCOMPRESSED_BYTES);
    const over = new Uint8Array(MAX_UNCOMPRESSED_BYTES + 1);
    expect(() => unpackZip(packZip(new Map([['x.bin', over]])))).toThrow(/TOO_LARGE/);
  });

  it('KÍCH THƯỚC KHAI BÁO TRONG HEADER LÀ LỜI KẺ TẤN CÔNG, KHÔNG PHẢI SỰ THẬT', () => {
    // Bài học của Task 1, áp vào đây: đừng quyết định dựa trên thứ kẻ tấn công
    // đặt tên được. Trường "uncompressed size" của local header là 4 byte kẻ
    // tấn công tự ghi. `unpackZip` ĐƯỢC PHÉP dùng nó để từ chối SỚM (đường tắt
    // rẻ tiền cho quả bom thật thà), nhưng không được TIN nó để chấp nhận.
    //
    // Gói dưới đây khai 1 byte và thực sự bung ra 21 MiB. Chỉ có phép đếm byte
    // THẬT trong lúc bung mới bắt được.
    const bomb = packZip(new Map([['big.txt', new Uint8Array(21 * 1024 * 1024)]]));
    const lying = lieAboutUncompressedSize(bomb, 1);
    expect(lying).not.toEqual(bomb); // phép vá thực sự đã đổi byte
    expect(() => unpackZip(lying)).toThrow(/TOO_LARGE/);
  });

  it('KHO 128 MiB KHÔNG KHAI KÍCH THƯỚC: dừng ở ~24 MiB, KHÔNG phải ở 128 MiB', { timeout: 120_000 }, () => {
    // ĐÂY là dòng phân biệt "kiểm TRONG lúc giải nén" với "kiểm SAU khi giải
    // nén" — và ba ca của đề bài KHÔNG phân biệt được. Đo, không đoán: một bản
    // dựng rơm ("unzipSync rồi cộng tổng") được viết ra trước và cho 19/31 test
    // XANH, trong đó có cả ca bom 21 MiB của đề bài. Nó xanh vì nó thật sự có
    // ném — chỉ là sau khi đã cấp phát xong 21 MiB.
    //
    // Kho này khai báo qua data descriptor nên local header KHÔNG mang kích
    // thước: đường tắt "từ chối theo kích thước khai báo" không thể nổ, chỉ còn
    // phép đếm byte thật. `bytesRead` là bằng chứng: bản đúng dừng ở 23,77 MiB
    // dù kho bung ra 128 MiB; bản "kiểm sau" báo đủ 134.217.728.
    //
    // Đo trên cùng máy, cùng quả bom, dựng bằng unzipSync (bản rơm) ở kích
    // thước 1 GiB: 9.557 ms và RSS 186 → 775 MiB. Bản này: ~210 ms, RSS phẳng.
    const bomb = streamedBomb('big.bin', 128 * 1024 * 1024);
    expect(bomb.byteLength).toBeLessThan(256 * 1024); // ~132 KB nén
    const err = catchUnsafe(() => unpackZip(bomb));
    expect(err.code).toBe('TOO_LARGE');
    expect(
      err.bytesRead,
      `đã giải nén ${(err.bytesRead / 1024 / 1024).toFixed(2)} MiB trước khi dừng`,
    ).toBeLessThan(2 * MAX_UNCOMPRESSED_BYTES);
  });

  it('ĐIỂM DỪNG không phụ thuộc kích thước kho: tỉ số thời gian của HAI quả bom khác cỡ', () => {
    // Ca ngay trên chấm `err.bytesRead` — một con số do CHÍNH cài đặt ghi ra.
    // Đo được, không phải lo xa: một biến thể hai dòng (chuyển phép kiểm trần ra
    // SAU vòng push, rồi khai `bytesRead = MAX + 1` cho "trông hợp lý") QUA SẠCH
    // toàn bộ bộ test, trong khi vẫn bung trọn quả bom:
    //
    //   bom     | bản đúng            | bản khai láo `bytesRead`
    //   --------|---------------------|-------------------------
    //    32 MiB | 194–200 ms          |  267–288 ms
    //   256 MiB | 193–202 ms          | 2.156–2.247 ms
    //   RSS     | 165–196 MB          | 769–1.047 MB
    //   (ở 64/512 MiB thì cùng câu chuyện, đắt gấp đôi: 0,97–0,99 so với
    //    7,84–8,08, RSS bản rơm 2.122 MB — chọn 32/256 cho cổng chạy nhanh)
    //
    // Doc của `bytesRead` nói nó "là bằng chứng rằng trần được áp TRONG lúc giải
    // nén"; nó chỉ là bằng chứng nếu không ai sửa được nó, mà sửa nó là hai
    // dòng. Cùng họ với bài học của Task 1: một luật khoá theo thứ kẻ tấn công
    // viết được thì kẻ tấn công viết lại nó — ở đây "kẻ tấn công" là người
    // refactor sau này.
    //
    // Nên dòng bắt mutant là một đại lượng cài đặt KHÔNG tự khai được: thời gian
    // dừng của hai quả bom khác cỡ, đo liền nhau trong cùng tiến trình. Bản đúng
    // dừng ở CÙNG một chỗ (24.924.788 byte) bất kể kho khai bao nhiêu, nên tỉ số
    // ≈ 1; bản bung hết thì tỉ số ≈ 8 vì nó tuyến tính theo kho. Vạch 3 nằm giữa
    // hai cụm [0,97–1,04] và [7,80–8,21]: cách cụm xanh 2,9× và cụm đỏ 2,6×.
    // Máy chậm làm chậm CẢ HAI vế, và cả hai vế đều ≥150 ms nên nhiễu lịch trình
    // là <2% chứ không phải 250% — đúng điều kiện mà sổ P2-F11 chỉ ra.
    const stop = (bomb: Uint8Array): number => {
      const t0 = Date.now();
      expect(catchUnsafe(() => unpackZip(bomb)).code).toBe('TOO_LARGE');
      return Date.now() - t0;
    };
    const small = streamedBomb('big.bin', 32 * 1024 * 1024);
    const large = streamedBomb('big.bin', 256 * 1024 * 1024);
    // Quả NHỎ đo trước: nó gánh phần khởi động của tiến trình, nên tỉ số nghiêng
    // về phía khó đỏ oan chứ không nghiêng về phía dễ dãi với mutant.
    const one = stop(small);
    const eight = stop(large);
    const ratio = eight / Math.max(one, 1);
    expect(
      ratio,
      `kho gấp 8 lần mất ${eight} ms so với ${one} ms (tỉ số ${ratio.toFixed(2)}) — điểm dừng đang chạy theo kích thước kho, tức là kho ĐÃ được bung hết`,
    ).toBeLessThan(3);
  });

  it('ĐỐI CHỨNG cho ca trên: cùng cách dựng, kích thước lành thì đọc ĐÚNG', () => {
    // Nếu không có dòng này thì ca trên có thể xanh vì `streamedBomb` dựng ra
    // một kho hỏng chứ không phải vì cái chốt chạy đúng.
    const small = streamedBomb('big.bin', 3 * 1024 * 1024);
    const back = unpackZip(small);
    expect(back.get('big.bin')?.byteLength).toBe(3 * 1024 * 1024);
  });

  it('phần đã đọc được KHÔNG được trả về sau khi ném — không có nửa gói', () => {
    // Một cài đặt "gom hết rồi mới kiểm" dễ bị sửa thành "trả về những gì đã
    // đọc". Đó là một gói KHÁC gói người dùng đưa vào, và validatePackage sẽ
    // chấm điểm cho nó. Chỉ có ném.
    const files = new Map<string, Uint8Array>([
      ['manifest.json', enc('{}')],
      ['big.bin', new Uint8Array(MAX_UNCOMPRESSED_BYTES + 1)],
    ]);
    let caught: unknown;
    try {
      unpackZip(packZip(files));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnsafeArchiveError);
    expect((caught as UnsafeArchiveError).code).toBe('TOO_LARGE');
  });
});

// ---------------------------------------------------------------------------
// Đường dẫn — cùng một câu hỏi mà `validate.ts` đã trả lời một lần.
// ---------------------------------------------------------------------------

describe('đường dẫn thoát khỏi gói', () => {
  const cases: readonly string[] = [
    '../thoat.txt',
    'a/../../thoat.txt',
    '/tuyet-doi.txt',
    'C:\\windows\\evil.txt',
    // Cùng đường dẫn Windows, viết bằng dấu gạch chéo XUÔI. Ca ngay trên xanh
    // vì luật "có ký tự \", KHÔNG phải vì "là đường tuyệt đối" — nên nó tạo cảm
    // giác đường ổ đĩa đã được xử lý trong khi ba dòng dưới đây từng đi lọt.
    // Đo bằng đúng ngữ nghĩa Windows của Node:
    //   path.win32.resolve('C:\\pkg', 'C:/evil.txt') → "C:\\evil.txt"  ← ra khỏi gói
    //   path.win32.resolve('C:\\pkg', 'C:evil.txt')  → "C:\\pkg\\evil.txt"
    // Dạng thứ hai không thoát, nhưng nó là đường dẫn TƯƠNG ĐỐI THEO Ổ ĐĨA:
    // nghĩa của nó phụ thuộc thư mục hiện hành của ổ C: lúc giải nén. Một cái
    // tên mà ý nghĩa do máy người đọc quyết định thì không có chỗ trong gói.
    'C:/evil.txt',
    'c:/evil.txt',
    'C:evil.txt',
    'a\\b.txt',
    '',
  ];
  for (const name of cases) {
    it(`NÉM với "${name}"`, () => {
      const evil = rawZip([[name, new Uint8Array([1])]]);
      const err = catchUnsafe(() => unpackZip(evil));
      expect(err.code).toBe('PATH_ESCAPE');
      expect(err.entry).toBe(name);
    });
  }

  it('mục hợp lệ ĐỨNG TRƯỚC mục độc vẫn làm cả gói bị ném', () => {
    // Không có "trả về phần lành". Một mục xấu là cả kho xấu.
    const evil = rawZip([
      ['manifest.json', enc('{}')],
      ['../thoat.txt', new Uint8Array([1])],
    ]);
    expect(catchUnsafe(() => unpackZip(evil)).code).toBe('PATH_ESCAPE');
  });

  it('KHÔNG giải mã %2e%2e — giải mã URL là việc của người khác, và họ không được làm', () => {
    // Ghi lại giới hạn thay vì để người sau tự phát hiện: `%2e%2e/x` là một tên
    // tệp hợp lệ, không phải một đường thoát — TRỪ KHI ai đó decodeURIComponent
    // nó trước khi ghi ra đĩa. Đó là lỗi của người ghi.
    const m = unpackZip(rawZip([['%2e%2e/x.txt', enc('x')]]));
    expect([...m.keys()]).toEqual(['%2e%2e/x.txt']);
  });
});

// ---------------------------------------------------------------------------
// Nhập nhằng: hai mục cùng tên, và tệp không phải zip.
// ---------------------------------------------------------------------------

describe('kho nhập nhằng bị từ chối thay vì bị đoán', () => {
  it('hai mục TRÙNG TÊN bị NÉM — Map sẽ âm thầm chọn cái sau', () => {
    // Cổ điển: bộ kiểm định đọc mục này, trình đọc đọc mục kia. `new Map()` tự
    // nó chọn cái ghi sau mà không nói gì. Trong một kho gói khoá học, không có
    // lý do lành nào để hai mục trùng tên.
    const dup = rawZip([
      ['manifest.json', enc('{"tier":"content"}')],
      ['manifest.json', enc('{"tier":"interactive"}')],
    ]);
    const err = catchUnsafe(() => unpackZip(dup));
    expect(err.code).toBe('DUPLICATE_ENTRY');
    expect(err.entry).toBe('manifest.json');
  });

  it('trùng tên theo HOA/THƯỜNG cũng là trùng — trên APFS và NTFS đó là MỘT tệp', () => {
    // Luật `DUPLICATE_ENTRY` tồn tại để từ chối cái nhập nhằng "hai mục, một
    // tệp". So khớp phân biệt hoa thường trả lời câu hỏi đó theo ngữ nghĩa của
    // `Map`, không theo ngữ nghĩa của hệ tệp mà gói sẽ được ghi ra: macOS (APFS,
    // mặc định không phân biệt hoa thường) và Windows (NTFS) đều coi
    // `manifest.json` và `MANIFEST.JSON` là một. Người ghi ra đĩa — `tuhoc` CLI —
    // sẽ giữ cái sau; bộ kiểm định đọc cái đầu. Đúng cái bất đồng này.
    const dup = rawZip([
      ['manifest.json', enc('{"tier":"content"}')],
      ['MANIFEST.JSON', enc('{"tier":"interactive"}')],
    ]);
    const err = catchUnsafe(() => unpackZip(dup));
    expect(err.code).toBe('DUPLICATE_ENTRY');
    expect(err.entry).toBe('MANIFEST.JSON');
  });

  it('trùng tên theo CHUẨN HOÁ UNICODE cũng là trùng — hai chuỗi, một tên tệp', () => {
    // `café.txt` viết bằng NFC (é = U+00E9) và bằng NFD (e + U+0301) là hai
    // chuỗi JavaScript khác nhau in ra GIỐNG HỆT nhau, và trên macOS là cùng một
    // tệp. Một mục lục trộn hai dạng là cách viết "hai mục trùng tên" mà mắt
    // người đọc diff không thấy được.
    const nfc = 'café.txt';
    const nfd = 'café.txt';
    expect(nfc).not.toBe(nfd); // hai chuỗi thật sự khác nhau…
    expect(nfc.normalize('NFD')).toBe(nfd); // …và đúng là hai dạng của MỘT tên
    const err = catchUnsafe(() => unpackZip(rawZip([[nfc, enc('a')], [nfd, enc('b')]])));
    expect(err.code).toBe('DUPLICATE_ENTRY');
    expect(err.entry).toBe(nfd);
  });

  it('ĐỐI CHỨNG: hai tên KHÁC nhau thật thì vẫn qua, kể cả khi chỉ khác một chữ', () => {
    // Không có dòng này thì luật ở trên có thể là "từ chối mọi thứ na ná nhau".
    expect([...unpackZip(rawZip([['a.txt', enc('a')], ['ab.txt', enc('b')]])).keys()])
      .toEqual(['a.txt', 'ab.txt']);
  });

  it('rác không phải zip bị NÉM, KHÔNG trả về Map rỗng', () => {
    // `fflate.Unzip` quét tìm chữ ký local header; không thấy cái nào thì nó
    // kết thúc êm ru. Một Map rỗng đi tiếp tới `validatePackage` sẽ thành
    // EMPTY_PACKAGE — đúng là hỏng, nhưng sai lý do, và người dùng đọc được
    // "gói không có tệp nào" cho một tệp .docx đặt nhầm tên.
    expect(() => unpackZip(enc('đây không phải là tệp zip'))).toThrow(/MALFORMED/);
    expect(() => unpackZip(new Uint8Array(0))).toThrow(/MALFORMED/);
  });

  it('rác ĐỨNG TRƯỚC một zip thật cũng bị NÉM — không nhận tệp lai', () => {
    // Một tệp vừa là ảnh vừa là zip (polyglot) là công cụ để lách bộ lọc theo
    // magic number ở đầu chuỗi xử lý. Zip của gói khoá học do CLI của chính dự
    // án sinh ra và luôn bắt đầu bằng "PK\x03\x04".
    const good = packZip(new Map([['manifest.json', enc('{}')]]));
    const polyglot = new Uint8Array(4 + good.length);
    polyglot.set(enc('GIF8'), 0);
    polyglot.set(good, 4);
    expect(() => unpackZip(polyglot)).toThrow(/MALFORMED/);
  });

  it('zip bị CẮT CỤT giữa chừng bị NÉM, không trả về phần đọc được', () => {
    const good = packZip(new Map([['a.bin', new Uint8Array(200_000)]]));
    expect(() => unpackZip(good.subarray(0, good.length - 400))).toThrow(UnsafeArchiveError);
  });

  it('cắt cụt NGAY TRONG local header: mất hẳn một mục mà KHÔNG có lỗi nào — lỗ đã bịt', () => {
    // Đo được, không phải giả định. Trước khi có phép đối chiếu số mục ở cuối
    // `unpackZip`, bốn nhát cắt dưới đây đều cho `keys=["a.txt"]` và KHÔNG ném
    // gì cả: người gọi nhận về một gói NHỎ HƠN gói họ đưa vào, không dấu hiệu.
    // `fflate` bỏ qua local header cụt vì nó chưa đủ dài để đọc (`Unzip.push`:
    // `if (l > i + 30 + fnl + es)`), rồi kết thúc êm ru.
    const good = packZip(new Map([['a.txt', enc('AAAA')], ['b.txt', enc('BBBBBBBB')]]));
    const second = localHeaderOffsets(good)[1] as number;
    for (const past of [4, 10, 25, 33]) {
      const err = catchUnsafe(() => unpackZip(good.subarray(0, second + past)));
      expect(err.code, `cắt ở local header thứ 2 + ${past}`).toBe('MALFORMED');
    }
  });

  it('mất hẳn mục lục cuối tệp thì NÉM — hai nửa của zip phải cùng tồn tại', () => {
    // Cắt đúng 22 byte cuối là bỏ end-of-central-directory. Dữ liệu mục vẫn
    // đọc được theo dòng, nên bản không đối chiếu trả về ĐỦ hai tệp và không
    // ném — trong khi `unzip(1)` hay `unzipSync`, vốn đọc mục lục, sẽ từ chối
    // chính tệp đó. Hai công cụ, hai câu trả lời: đúng thứ phải chặn.
    const good = packZip(new Map([['a.txt', enc('AAAA')], ['b.txt', enc('BBBB')]]));
    expect(catchUnsafe(() => unpackZip(good.subarray(0, good.length - 22))).code).toBe('MALFORMED');
  });

  it('kho KHÔNG có mục lục bị từ chối TRƯỚC khi bung một byte nào', () => {
    // Phép đối chiếu số mục ở CUỐI cũng đủ để ném, nên dòng này không nói về
    // "có ném hay không" mà về "ném vào lúc nào": `bytesRead === 0` là lời hứa
    // rằng một kho hỏng không tốn gì cả. Bỏ phép kiểm mục lục ở đầu hàm thì
    // quả bom 128 MiB dưới đây vẫn bị chặn — sau khi đã bung 24 MiB.
    const bomb = streamedBomb('big.bin', 128 * 1024 * 1024);
    const err = catchUnsafe(() => unpackZip(bomb.subarray(0, bomb.length - 22)));
    expect(err.code).toBe('MALFORMED');
    expect(err.bytesRead, 'kho không có mục lục thì không được giải nén gì cả').toBe(0);
  });

  it('byte thừa SAU mục lục bị từ chối — nối đuôi cũng là tệp lai', () => {
    // Ảnh chiếu của luật "phải bắt đầu bằng chữ ký zip". Nếu chỉ quét ngược tìm
    // "PK\x05\x06" mà không kiểm trường độ dài chú thích, thì mọi thứ nối vào
    // đuôi tệp đều được nuốt im lặng: kho vẫn đọc được, số mục vẫn khớp, và
    // phần đuôi — thứ mà công cụ khác có thể diễn giải kiểu khác — không ai
    // nhắc tới. Trường độ dài chú thích phải chạm đúng cuối tệp.
    const good = packZip(new Map([['a.txt', enc('AAAA')]]));
    const withTail = new Uint8Array(good.length + 16);
    withTail.set(good, 0);
    withTail.set(enc('TRAILINGGARBAGE!'), good.length);
    expect(catchUnsafe(() => unpackZip(withTail)).code).toBe('MALFORMED');
  });

  it('mục lục KHAI SỐ MỤC SAI thì NÉM, kể cả khi dữ liệu đọc được', () => {
    // Trường "tổng số mục" nằm ở offset 10 của EOCD. Sửa nó thành 3 trong khi
    // chỉ có 2 local header: đây là dạng "hai nửa của kho nói khác nhau", và
    // phép đối chiếu chỉ có nghĩa nếu nó thực sự so sánh.
    const good = packZip(new Map([['a.txt', enc('AAAA')], ['b.txt', enc('BBBB')]]));
    const tampered = good.slice();
    tampered[tampered.length - 22 + 10] = 3;
    expect(catchUnsafe(() => unpackZip(tampered)).code).toBe('MALFORMED');
    // …và ĐỐI CHỨNG: chưa sửa thì đọc bình thường.
    expect([...unpackZip(good).keys()]).toEqual(['a.txt', 'b.txt']);
  });

  it('số mục 0xFFFF (sentinel zip64) bị từ chối NGAY, không bị đối chiếu nhầm', () => {
    // 0xFFFF ở trường số mục nghĩa là "số thật nằm trong bản ghi zip64", và
    // module này không đọc bản ghi đó. Nhánh từ chối ấy có doc nhưng không có
    // lưới: bỏ nó đi thì phép đối chiếu số mục ở CUỐI hàm vẫn ném MALFORMED, nên
    // chấm `code` thôi không phân biệt được. Hai thứ phân biệt được: lý do ném,
    // và ném vào LÚC NÀO — bỏ nhánh này thì kho được bung xong rồi mới bị chê.
    const good = packZip(new Map([['a.txt', enc('AAAA')]]));
    const sentinel = good.slice();
    sentinel[sentinel.length - 22 + 10] = 0xff;
    sentinel[sentinel.length - 22 + 11] = 0xff;
    const err = catchUnsafe(() => unpackZip(sentinel));
    expect(err.code).toBe('MALFORMED');
    expect(err.message).toContain('zip64');
    expect(err.bytesRead, 'kho zip64 không được bung một byte nào').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hai nửa của một zip phải nói CÙNG MỘT chuyện — ở mức TÊN, không chỉ mức SỐ.
//
// `fflate.Unzip` (thứ `unpackZip` dùng) đi theo local header. `unzipSync`,
// `python zipfile`, `java.util.zip`, `JSZip`, `unzip(1)` đi theo mục lục ở cuối
// tệp. Phép đối chiếu SỐ MỤC bịt được bất đồng về số lượng; bất đồng về TÊN thì
// không, và tên chính là phần mang đường thoát.
// ---------------------------------------------------------------------------

describe('mục lục và local header phải khai cùng những cái tên', () => {
  it('local khai "manifest.json", mục lục khai "../../evil.js" → NÉM', () => {
    // Đo bằng bốn trình đọc trên ĐÚNG những byte này (xem báo cáo), trước khi
    // có luật:
    //   unpackZip         : ACCEPTED keys=["manifest.json"]   ← cổng nói ĐƯỢC
    //   fflate.unzipSync  : ["../../evil.js"]
    //   python3 zipfile   : ['../../evil.js']
    //   /usr/bin/unzip -l : ../../evil.js
    // Không trình nào ghi ra ngoài thư mục đích (Info-ZIP cắt "../" rồi cảnh
    // báo; ditto dùng tên local) — nhưng đó là may, không phải luật, và nó
    // KHÔNG phải vấn đề chính. Vấn đề chính: tệp đã qua kiểm định
    // (`manifest.json`) và tệp mọi công cụ khác nhìn thấy (`evil.js`) là HAI tệp
    // khác nhau. Sổ đăng ký lưu byte gói gốc; người tải về mở bằng công cụ của
    // họ và nhận một gói chưa từng đi qua cổng này.
    //
    // Hai tên dài BẰNG NHAU (13 ký tự) nên không một byte nào khác trong kho
    // phải dịch chỗ, và số mục vẫn 1 = 1: phép đối chiếu số mục không chạm tới.
    const good = packZip(new Map([['manifest.json', enc('{"id":"demo"}')]]));
    const forged = renameInCentralDirectory(good, 'manifest.json', '../../evil.js');
    expect(forged).not.toEqual(good); // phép vá thực sự đã đổi byte
    const err = catchUnsafe(() => unpackZip(forged));
    expect(err.code).toBe('MALFORMED');
    expect(err.bytesRead, 'kho hai-nửa-nói-khác-nhau không được bung một byte nào').toBe(0);
  });

  it('bất đồng tên bị chặn kể cả khi CẢ HAI tên đều vô hại', () => {
    // Luật là "hai nửa phải khớp", KHÔNG phải "tên trong mục lục không được
    // thoát ra". Nếu chỉ chạy `escapesPackage` trên tên mục lục thì cặp
    // (a.txt, b.txt) đi lọt — mà nó vẫn là hai gói khác nhau cho hai trình đọc.
    const good = packZip(new Map([['a.txt', enc('AAAA')]]));
    const forged = renameInCentralDirectory(good, 'a.txt', 'b.txt');
    expect(catchUnsafe(() => unpackZip(forged)).code).toBe('MALFORMED');
  });

  it('ĐỐI CHỨNG: kho chưa bị vá — cùng đường đi, cùng helper — đọc bình thường', () => {
    // Không có dòng này thì hai ca trên có thể xanh vì `renameInCentralDirectory`
    // làm hỏng kho, chứ không phải vì phép đối chiếu tên chạy đúng.
    const good = packZip(new Map([['a.txt', enc('AAAA')], ['b.txt', enc('BBBB')]]));
    expect([...unpackZip(renameInCentralDirectory(good, 'a.txt', 'a.txt')).keys()])
      .toEqual(['a.txt', 'b.txt']);
  });

  it('byte lạ GIỮA mục lục và footer của nó cũng bị từ chối', () => {
    // Ảnh chiếu vào bên trong của luật "không có byte thừa ở hai đầu tệp". Chèn
    // rác vào GIỮA bản ghi cuối của mục lục và bản ghi EOCD: mọi phép kiểm cũ
    // vẫn xanh — local header còn nguyên, số mục vẫn khớp, trường độ dài chú
    // thích vẫn chạm đúng cuối tệp — nên chỗ này là chỗ duy nhất còn lại để
    // giấu byte mà một trình đọc khác có thể diễn giải kiểu khác. Các bản ghi
    // phải kết thúc ĐÚNG ở chỗ footer bắt đầu.
    const good = packZip(new Map([['a.txt', enc('AAAA')]]));
    const eocd = good.length - 22; // không có chú thích, nên EOCD là 22 byte cuối
    const junk = enc('TRAILINGGARBAGE!');
    const spliced = new Uint8Array(good.length + junk.length);
    spliced.set(good.subarray(0, eocd), 0);
    spliced.set(junk, eocd);
    spliced.set(good.subarray(eocd), eocd + junk.length);
    expect(catchUnsafe(() => unpackZip(spliced)).code).toBe('MALFORMED');
  });

  it('tên KHÔNG PHẢI ASCII vẫn so khớp được — phép giải mã hai bên phải giống nhau', () => {
    // Phép đối chiếu chỉ có nghĩa nếu tên trong mục lục được giải mã ĐÚNG như
    // `fflate` giải mã tên trong local header: UTF-8 khi bit 11 của general
    // purpose flag bật, còn không thì từng byte một. Sai một trong hai thì gói
    // tiếng Việt nào cũng thành MALFORMED — một cổng "an toàn" vì nó từ chối
    // tất cả.
    const files = new Map([['assets/anh nền.png', enc('x')], ['trống.txt', enc('y')]]);
    expect([...unpackZip(packZip(files)).keys()]).toEqual(['assets/anh nền.png', 'trống.txt']);
  });
});

// ---------------------------------------------------------------------------
// Kho do CÔNG CỤ NGOÀI đóng — byte thật, không phải bản dựng lại bằng tay.
//
// Mọi fixture dưới đây nằm trong `fixtures/`, do Info-ZIP 3.0 (`/usr/bin/zip`
// của macOS) sinh ra, và mỗi cái đều QUA `unzip -t`, `python zipfile` và
// `ditto -x -k`. Lệnh sinh ra chúng ghi ngay tại từng ca — dựng lại được, và
// một bản dựng lại bằng tay thì không chứng minh được điều đang cần chứng
// minh: rằng công cụ người ta thật sự dùng viết ra hình dạng này.
//
// Vì sao gói này phải đọc được chúng: `unpackZip` không chỉ đọc gói do CLI của
// repo sinh ra. Task 8 nhập gói từ URL bất kỳ và từ GitHub (zipball), tức đúng
// loại kho do công cụ ngoài đóng, và mỗi lần từ chối OAN ở đây là một gói hợp
// lệ mà người dùng không mở được.
// ---------------------------------------------------------------------------

describe('kho do công cụ ngoài đóng', () => {
  it('(a) `zip -fz`: EOCD khai cdoff = 0xFFFFFFFF, offset THẬT nằm trong bản ghi zip64', () => {
    // Sinh bằng:  printf '{"id":"demo"}' > manifest.json && zip -fz q.zip manifest.json
    //
    // `-fz` là "dùng zip64 kể cả khi không cần". Info-ZIP khi đó đặt trường
    // "offset của mục lục" trong EOCD thành sentinel 0xFFFFFFFF và ghi offset
    // thật vào bản ghi zip64 — nên một trình đọc chỉ nhìn EOCD sẽ nhảy tới
    // 4 GiB và không thấy gì.
    const zip = fixture('zip64-forced.zip');
    expect(u32le(zip, zip.length - 22 + 16), 'fixture phải THẬT SỰ mang sentinel').toBe(0xffffffff);
    const out = unpackZip(zip);
    expect([...out.keys()]).toEqual(['manifest.json']);
    expect(new TextDecoder('utf-8').decode(out.get('manifest.json'))).toBe('{"id":"demo"}');
  });

  it('(b) `cat tệp | zip out.zip -`: KHÔNG một cờ nào cả — và vẫn là zip64', () => {
    // Sinh bằng:  printf '{"id":"demo"}' > manifest.json && cat manifest.json | zip q.zip -
    //
    // Đây mới là ca đáng lo. Không ai gõ cờ nào; Info-ZIP tự chèn bản ghi zip64
    // vì đọc từ ống thì nó chưa biết kích thước. Ống một tệp vào `zip` là thao
    // tác hoàn toàn bình thường, nên "chỉ kho lạ mới có zip64" là sai.
    //
    // Và cdoff ở đây KHÔNG phải sentinel: khoảng thừa 76 byte là toàn bộ vấn
    // đề, tách hẳn khỏi ca (a).
    const zip = fixture('zip64-stdin.zip');
    expect(u32le(zip, zip.length - 22 + 16), 'ca này KHÔNG được dựa vào nhánh sentinel').not.toBe(0xffffffff);
    const out = unpackZip(zip);
    // `zip out.zip -` đặt tên mục là "-"; đó là tên Info-ZIP viết ra, không
    // phải lựa chọn của bài test. Tên có hợp lệ cho một gói khoá học hay không
    // là việc của `validate.ts`, không phải của tầng container.
    expect([...out.keys()]).toEqual(['-']);
    expect(new TextDecoder('utf-8').decode(out.get('-'))).toBe('{"id":"demo"}');
  });

  it('phép so tập TÊN vẫn chạy trên kho zip64 — không phải "thấy zip64 thì thôi"', () => {
    // Nếu bản sửa nới bằng cách BỎ QUA mục lục khi gặp zip64, hai ca trên vẫn
    // xanh còn luật đắt nhất của module thì tắt lặng lẽ. Cùng phép vá, cùng
    // helper như khối ở trên, chỉ khác là kho mang bản ghi zip64.
    const forged = renameInCentralDirectory(fixture('zip64-stdin.zip'), '-', 'x');
    const err = catchUnsafe(() => unpackZip(forged));
    expect(err.code).toBe('MALFORMED');
    expect(err.bytesRead, 'bất đồng tên phải chặn TRƯỚC khi bung byte nào').toBe(0);
  });

  it('`zip -r` tên tiếng Việt, bit 11 TẮT: hai nửa phải cùng đọc từng byte một', () => {
    // Sinh bằng:  mkdir -p chapters && printf '<h1>Bai hoc</h1>' > 'chapters/bài-học-số-1.html'
    //             && zip -r q.zip chapters
    //
    // Info-ZIP 3.0 trên macOS ghi tên bằng byte UTF-8 nhưng KHÔNG bật bit 11
    // của general purpose flag. `fflate` đọc local header theo đúng bit đó, tức
    // từng byte một, nên `centralDirectoryNames` bắt buộc phải làm y hệt —
    // nếu nó luôn giải mã UTF-8 thì mọi gói tiếng Việt do `zip -r` đóng đều
    // thành MALFORMED. Đó chính là lý do đoạn doc của `decodeEntryName` viện ra
    // và cho tới ca này thì KHÔNG test nào ghim.
    const zip = fixture('infozip-vietnamese.zip');
    const out = unpackZip(zip);
    // Tên trả về là byte UTF-8 đọc từng byte một — xấu, nhưng đó là điều
    // `fflate` thấy, và điều bài test này ghim là HAI NỬA THẤY GIỐNG NHAU.
    // Mục `chapters/` là 0 byte, mang tên thư mục, nên bị bỏ đúng như mọi kho
    // khác: 2 mục trong mục lục, 1 tệp trong Map.
    expect([...out.keys()]).toEqual([latin1(enc('chapters/bài-học-số-1.html'))]);
    expect(new TextDecoder('utf-8').decode([...out.values()][0])).toBe('<h1>Bai hoc</h1>');
  });

  it('`zip -c` bình luận RIÊNG từng mục: bước nhảy phải cộng cả độ dài bình luận', () => {
    // Sinh bằng:  printf 'AAAA' > a.txt && zip q.zip a.txt
    //             && printf 'ghi chu\n' | zip -c q.zip a.txt
    //
    // Bản ghi mục lục có ba trường độ dài biến thiên (tên, extra, bình luận) và
    // bước nhảy phải cộng đủ ba. Bỏ số hạng bình luận thì chỉ những kho CÓ bình
    // luận mới sai — mà `packZip` không bao giờ ghi bình luận, nên trước ca này
    // cả lưới test không có kho nào như vậy.
    const out = unpackZip(fixture('entry-comments.zip'));
    expect([...out.keys()]).toEqual(['a.txt']);
    expect(new TextDecoder('utf-8').decode(out.get('a.txt'))).toBe('AAAA');
  });
});

// ---------------------------------------------------------------------------
// Bản sửa ở trên là "nhận ĐÚNG một hình dạng", KHÔNG phải "bỏ qua byte thừa".
// Khối này là phần chứng minh câu đó — mỗi ca dựng đúng thứ mà một bản nới quá
// tay sẽ cho lọt.
// ---------------------------------------------------------------------------

describe('chỉ ĐÚNG hình dạng zip64 được nhận, byte thừa khác vẫn bị từ chối', () => {
  it('ĐỐI CHỨNG: 76 byte thừa KHÔNG PHẢI zip64 vẫn bị từ chối — luật là hình dạng, không phải độ dài', () => {
    // Đúng 56 + 20 byte, y hệt khoảng trống một cặp zip64 EOCD + locator để
    // lại, nhưng nội dung là rác. Một bản sửa chỉ so `eocd - at === 76` sẽ nhận
    // kho này; hình dạng thật thì không.
    const spliced = spliceBeforeEocd(packZip(new Map([['a.txt', enc('AAAA')]])), new Uint8Array(76).fill(0x41));
    expect(catchUnsafe(() => unpackZip(spliced)).code).toBe('MALFORMED');
  });

  it('ĐỐI CHỨNG: bản ghi zip64 THIẾU locator (còn 56 byte) bị từ chối', () => {
    // Kho thật của ca (b), cắt bỏ đúng 20 byte locator ở cuối. Bản ghi zip64
    // vẫn còn nguyên và vẫn bắt đầu bằng `PK\x06\x06`, nên ca này ghim rằng
    // phép nhận đòi CẢ CẶP chứ không chỉ chữ ký đầu.
    const zip = fixture('zip64-stdin.zip');
    const eocd = zip.length - 22;
    const cut = new Uint8Array(zip.length - 20);
    cut.set(zip.subarray(0, eocd - 20), 0);
    cut.set(zip.subarray(eocd), eocd - 20);
    expect(catchUnsafe(() => unpackZip(cut)).code).toBe('MALFORMED');
  });

  it('ĐỐI CHỨNG: chữ ký của locator bị bẻ (khoảng thừa vẫn đủ 76 byte) bị từ chối', () => {
    // Kho thật của ca (b), giữ nguyên mọi độ dài, chỉ bẻ 4 byte chữ ký
    // `PK\x06\x07`. Nhận theo "đủ 76 byte và mở đầu bằng PK\x06\x06" sẽ cho lọt;
    // nhận theo HÌNH DẠNG thì không.
    const zip = fixture('zip64-stdin.zip').slice();
    const locator = zip.length - 22 - 20;
    zip[locator + 3] = 0x09; // vẫn "PK\x06", không còn là locator
    expect(catchUnsafe(() => unpackZip(zip)).code).toBe('MALFORMED');
  });

  it('ĐỐI CHỨNG: bản ghi zip64 khai độ dài KHÁC 44 bị từ chối, không bị đoán chỗ kết thúc', () => {
    // Trường độ dài của chính bản ghi zip64 là thứ làm cho hằng số 56 được ĐỌC
    // ra từ kho chứ không phải giả định. Một bản ghi mang extensible data sector
    // (zip64 v2) dài hơn 56, và cái duy nhất module này biết chắc là nó KHÔNG
    // biết bản ghi đó kết thúc ở đâu.
    const zip = fixture('zip64-stdin.zip').slice();
    const record = zip.length - 22 - 20 - 56;
    zip[record + 4] = 60; // khai 60 thay vì 44
    expect(catchUnsafe(() => unpackZip(zip)).code).toBe('MALFORMED');
  });

  it('ĐỐI CHỨNG: cdoff = 0xFFFFFFFF mà KHÔNG có bản ghi zip64 nào bị từ chối', () => {
    // Sentinel là một lời hứa "offset thật nằm ở bản ghi zip64". Không có bản
    // ghi đó thì không có gì để đọc, và đoán là điều module này không làm.
    //
    // Ca này KHÔNG chỉ là vệ sinh. Nếu chỗ đọc offset zip64 được tin mà không
    // hỏi trước "bản ghi có thật không", nó đọc byte ở `eocd + 48`, và khi kho
    // mang CHÚ THÍCH thì những byte đó là của kẻ viết kho — xem ca ngay dưới.
    const zip = packZip(new Map([['a.txt', enc('AAAA')]])).slice();
    const at = zip.length - 22 + 16;
    zip[at] = zip[at + 1] = zip[at + 2] = zip[at + 3] = 0xff;
    expect(catchUnsafe(() => unpackZip(zip)).code).toBe('MALFORMED');
  });

  it('offset zip64 KHÔNG được lấy từ chú thích của kho — sentinel + chú thích dựng sẵn', () => {
    // Kho hợp lệ, đổi cdoff thành sentinel, rồi gắn một CHÚ THÍCH 40 byte đặt
    // đúng chỗ mà `eocd + 48` và `eocd + 52` rơi vào, mang offset THẬT của mục
    // lục. Một bản đọc bản ghi zip64 mà không kiểm bản ghi có tồn tại hay không
    // sẽ đọc trúng chú thích, thấy một offset hợp lệ, và NHẬN kho này — tức
    // nhận một trường do kẻ viết kho đặt vào chỗ nó không thuộc về.
    const good = packZip(new Map([['a.txt', enc('AAAA')]]));
    const eocd0 = good.length - 22;
    const cdStart = u32le(good, eocd0 + 16); // offset thật, trước khi bị che
    const COMMENT = 40;
    const zip = new Uint8Array(good.length + COMMENT);
    zip.set(good, 0);
    const eocd = eocd0;
    zip[eocd + 16] = zip[eocd + 17] = zip[eocd + 18] = zip[eocd + 19] = 0xff; // cdoff = sentinel
    zip[eocd + 20] = COMMENT & 0xff; // độ dài chú thích, vẫn chạm đúng cuối tệp
    zip[eocd + 21] = (COMMENT >> 8) & 0xff;
    for (let i = 0; i < 4; i++) zip[eocd + 48 + i] = (cdStart >>> (8 * i)) & 0xff; // nửa thấp
    for (let i = 0; i < 4; i++) zip[eocd + 52 + i] = 0; // nửa cao
    expect(catchUnsafe(() => unpackZip(zip)).code).toBe('MALFORMED');
  });

  it('offset mục lục vượt 4 GiB bị TỪ CHỐI, không bị cắt cụt cho vừa', () => {
    // Bản ghi zip64 mang offset u64. Gói này chỉ địa chỉ hoá được 32 bit, nên
    // nửa cao khác 0 là chỗ nó phải nói "không đọc được" thay vì lặng lẽ dùng
    // nửa thấp và đọc trúng một mục lục ở chỗ hoàn toàn khác.
    const zip = fixture('zip64-forced.zip').slice();
    const record = zip.length - 22 - 20 - 56;
    zip[record + 52] = 1; // nửa cao của "offset mục lục" = 1 → 4 GiB
    expect(catchUnsafe(() => unpackZip(zip)).code).toBe('MALFORMED');
  });

  it('chữ ký `PK\\x01\\x02` của bản ghi mục lục bị bẻ → mục lục không đọc được', () => {
    // `python zipfile` nói `BadZipFile: Bad magic number for central directory`
    // và `unzip` nói `zipfile corrupt` trên đúng những byte này. Nếu gói này
    // KHÔNG kiểm chữ ký, nó đọc chiều dài tên từ chỗ ngẫu nhiên và có thể vẫn
    // ráp ra một tập tên khớp — tức nhận một kho mọi công cụ khác từ chối.
    const zip = packZip(new Map([['manifest.json', enc('{}')]])).slice();
    let at = -1;
    for (let i = 0; i + 4 <= zip.length; i++) {
      if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x01 && zip[i + 3] === 0x02) at = i;
    }
    expect(at, 'kho phải có đúng một bản ghi mục lục để bẻ').toBeGreaterThan(0);
    zip[at + 2] = 0x09; // vẫn "PK", không còn là bản ghi mục lục
    expect(catchUnsafe(() => unpackZip(zip)).code).toBe('MALFORMED');
  });
});

// ---------------------------------------------------------------------------
// Vòng tròn — nội dung phải quay về NGUYÊN VẸN, không chỉ "gần đúng".
// ---------------------------------------------------------------------------

describe('vòng tròn giữ nguyên byte', () => {
  it('nhiều tệp, thư mục lồng, nhị phân, tên tiếng Việt', () => {
    const bin = new Uint8Array(512);
    for (let i = 0; i < bin.length; i++) bin[i] = (i * 37) & 0xff;
    const files = new Map<string, Uint8Array>([
      ['manifest.json', enc('{"id":"demo"}')],
      ['chapters/c1.html', enc('<p>Xin chào — “dấu”</p>')],
      ['assets/anh nền.png', bin],
      ['trống.txt', new Uint8Array(0)],
    ]);
    const back = unpackZip(packZip(files));
    expect([...back.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [name, bytes] of files) expect([...back.get(name)!]).toEqual([...bytes]);
  });

  it('ĐỌC được mục tên "__proto__" — Map miễn nhiễm với cái tên đó', () => {
    // Phía ĐỌC là phía nhận byte của người lạ, và nó không sao: kết quả là một
    // `Map`, còn `Map` coi `__proto__` như mọi khoá khác.
    const back = unpackZip(rawZip([['__proto__', enc('nội dung')]]));
    expect([...back.keys()]).toEqual(['__proto__']);
    expect(back.get('__proto__')).toEqual(enc('nội dung'));
  });

  it('GHI thì TỪ CHỐI tên "__proto__" — thà ném còn hơn ghi ra kho khác', () => {
    // Phía GHI thì không: `fflate` đánh địa chỉ mục bằng khoá object, và
    // `obj['__proto__'] = v` đặt prototype chứ không lưu gì. Cùng họ lỗi với
    // "quyết định theo đuôi tệp" — một cái tên đặc biệt đi một đường riêng mà
    // không ai canh. fflate 0.8.2 tình cờ chết ồn ào ở đó; "tình cờ" không phải
    // là một hợp đồng, nên `packZip` tự chặn.
    const err = catchUnsafe(() => packZip(new Map([['__proto__', enc('x')]])));
    expect(err.code).toBe('MALFORMED');
    expect(err.entry).toBe('__proto__');
    // …và chỉ ĐÚNG cái tên đó, không phải mọi tên chứa nó.
    expect([...unpackZip(packZip(new Map([['chapters/__proto__', enc('x')]]))).keys()])
      .toEqual(['chapters/__proto__']);
  });

  it('nội dung trả về KHÔNG chia sẻ bộ nhớ với zip đầu vào', () => {
    // Mục lưu ở dạng "stored" (nén 0) được fflate chuyển thẳng qua như một
    // subarray của buffer đầu vào. Người gọi sửa buffer đó — hoặc tái dùng nó —
    // thì Map đổi theo. Bản sao là bắt buộc.
    const zip = rawZip([['a.txt', enc('AAAA')]]);
    const back = unpackZip(zip);
    zip.fill(0);
    expect(back.get('a.txt')).toEqual(enc('AAAA'));
  });

  it('mục thư mục (0 byte, tên kết thúc bằng "/") bị bỏ, không thành tệp rỗng', () => {
    const zip = rawZip([
      ['chapters/', new Uint8Array(0)],
      ['chapters/c1.html', enc('<p>a</p>')],
    ]);
    expect([...unpackZip(zip).keys()]).toEqual(['chapters/c1.html']);
  });

  it('mục tên kết thúc bằng "/" nhưng CÓ nội dung thì KHÔNG bị bỏ', () => {
    // Ngược lại của luật trên, và đây là nửa quan trọng: "bỏ theo tên" là một
    // lỗ. Chỉ khi thực sự rỗng nó mới là dấu thư mục.
    const zip = rawZip([['la/', enc('không rỗng')]]);
    expect([...unpackZip(zip).keys()]).toEqual(['la/']);
  });
});

// ---------------------------------------------------------------------------
// packZip: đầu ra phải TÁI LẬP ĐƯỢC, vì sổ đăng ký sẽ băm nó.
// ---------------------------------------------------------------------------

describe('packZip sinh byte tái lập được', () => {
  it('đóng gói hai lần cho cùng byte', () => {
    // fflate mặc định ghi `Date.now()` vào mtime của từng mục. Hai lần đóng gói
    // cùng nội dung sẽ ra hai tệp khác nhau, và mọi thứ băm-theo-nội-dung ở
    // tầng trên (sổ đăng ký, cache trình duyệt) mất tác dụng.
    const files = new Map([['a.txt', enc('x')], ['b.txt', enc('y')]]);
    expect(packZip(files)).toEqual(packZip(files));
  });

  it('dấu thời gian là HẰNG SỐ đã ghim, không phải đồng hồ', () => {
    // Ca "đóng gói hai lần" ở trên KHÔNG bắt được `Date.now()`: hai lần chạy
    // cách nhau vài mili giây rơi vào cùng một ô 2 giây của DOS timestamp, nên
    // nó xanh cả với bản dựng rơm. Ghim thẳng 4 byte đó.
    //
    // 1985-01-01 00:00:00 giờ ĐỊA PHƯƠNG: (5<<25)|(1<<21)|(1<<16) = 0x0A210000,
    // little-endian ở offset 10 của local header. Giờ địa phương chứ không phải
    // UTC là có chủ ý: zip lưu giờ địa phương và fflate đọc bằng getFullYear(),
    // nên một MỐC THỜI GIAN cố định vẫn ra byte khác nhau ở múi giờ khác nhau —
    // một MẶT ĐỒNG HỒ cố định thì không.
    const z = packZip(new Map([['a.txt', enc('x')]]));
    expect([z[10], z[11], z[12], z[13]]).toEqual([0x00, 0x00, 0x21, 0x0a]);
  });

  it('thứ tự chèn vào Map KHÔNG đổi đầu ra', () => {
    const a = new Map([['a.txt', enc('x')], ['b.txt', enc('y')]]);
    const b = new Map([['b.txt', enc('y')], ['a.txt', enc('x')]]);
    expect(packZip(a)).toEqual(packZip(b));
  });

  it('gói rỗng vẫn là một zip đọc lại được', () => {
    expect([...unpackZip(packZip(new Map()))]).toEqual([]);
  });

  it('packZip KHÔNG kiểm định — chốt nằm ở phía ĐỌC, và đó là chủ ý', () => {
    // Ghi rõ để người sau không "sửa" nhầm: `packZip` phải đóng gói được cả
    // đường dẫn độc, nếu không thì không có cách nào viết bài kiểm tra ở trên.
    // Byte không tin được đến từ phía đọc, nên chốt ở phía đọc. CLI đóng gói
    // (task 3) tự gọi `validatePackage` trước khi gọi `packZip`.
    expect(() => packZip(new Map([['../x', enc('a')]]))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Gói THẬT. Sáu phép đo sai trong dự án này đã bị bác bỏ ở đúng bước này.
// ---------------------------------------------------------------------------

describe('gói thật: courses/so-dau-phay-dong', () => {
  /** vitest chạy với cwd = `packages/course-format` (xem Makefile: test-format). */
  const ROOT = '../../courses/so-dau-phay-dong';

  const readReal = (): Map<string, Uint8Array> => {
    // `courses/` là thư mục LÀM VIỆC, không phải nguồn — nội dung tới từ
    // `fixtures/courses/so-dau-phay-dong.zip`, một gói mẫu công khai được
    // commit và do `tuhoc pack` ghi ra (task 13). Trước task 13 chỗ này đọc
    // giáo trình riêng tư, thứ không có trên bản clone của người khác.
    //
    // Vắng gói đã bung thì khối này ĐỎ, không skip và không đổi sang dữ liệu
    // bịa: cái đang đo ở đây là 10 tệp thật đi qua pack/unpack không sai một
    // byte, và một bản dựng tay thì đo lại chính bản dựng tay. Chỉ có câu chữ
    // là thêm — `ENOENT` cũng đỏ, nhưng nó không nói phải gõ gì.
    if (!existsSync(ROOT)) {
      throw new Error(
        `Chưa bung gói mẫu ra ${ROOT} (cwd: packages/course-format).\n` +
          'Bung bằng `make courses` từ gốc repo — gói NẰM TRONG repo, xem docs/publishing.md §1.',
      );
    }
    const files = new Map<string, Uint8Array>();
    for (const name of readdirSync(ROOT).sort()) {
      if (name === 'chapters') continue;
      files.set(name, readFileSync(`${ROOT}/${name}`));
    }
    for (const name of readdirSync(`${ROOT}/chapters`).sort()) {
      files.set(`chapters/${name}`, readFileSync(`${ROOT}/chapters/${name}`));
    }
    return files;
  };

  // Lịch sử con số này, vì nó là thứ duy nhất trong repo từng bắt được rằng
  // một manifest vừa đổi mà không ai nói:
  //   1.263.009  giáo trình riêng, 46 tệp, lúc viết
  //   1.263.170  +164 ở task 11 (manifest lên v2: tier/license/authors/
  //              generatedBy), −3 khi chủ course xác nhận generatedBy là "ai"
  //     190.348  task 13: đổi hẳn ngữ liệu sang gói mẫu công khai, 10 tệp
  //     190.693  +345 khi cổng viz.spec.ts bắt được `vline(..., null, ...)`
  //              trong viz.js của gói và bản vá được đóng gói lại
  //
  // Nó phải được ĐO LẠI sau mỗi lần đóng gói lại `fixtures/courses/
  // so-dau-phay-dong`, không được nới thành `toBeGreaterThan`: một con số
  // chính xác là thứ duy nhất phân biệt "gói đổi vì có người sửa nó" với
  // "gói đọc hụt vài tệp".
  const REAL_BYTES = 190_693;
  const REAL_ENTRIES = 10;

  /**
   * Vân tay NỘI DUNG, không phải kích thước — và nó có mặt vì một mutant sống
   * sót ở task 13.
   *
   * Đối chứng đo được: thêm MỘT byte vào `chapters/appx.html` làm bài trên đỏ
   * (190.348 → 190.349). Đổi MỘT byte mà giữ nguyên độ dài — `chính` thành
   * `Chính` trong một tiêu đề — thì **cả khối này xanh**. Tổng byte và số tệp
   * không nhìn thấy nội dung, nên "gói mẫu là dữ liệu test của cả repo" chỉ
   * được canh bằng độ dài.
   *
   * FNV-1a 32 bit, gấp theo THỨ TỰ TÊN ĐÃ SẮP XẾP, tính ngay tại chỗ: không
   * thêm `node:crypto` vào `node-test-env.d.ts`, vì một khai báo module môi
   * trường thì cả dự án nhìn thấy và bài kiểm ở cuối tệp này tồn tại để bịt
   * đúng cửa đó. Không cần chống va chạm có chủ ý — thứ đang được canh là sửa
   * nhầm, không phải kẻ tấn công.
   */
  const REAL_FNV1A = 0x75bb05a3;

  const fingerprint = (files: Map<string, Uint8Array>): number => {
    let h = 0x811c9dc5;
    const mix = (byte: number): void => {
      h ^= byte;
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    for (const name of [...files.keys()].sort()) {
      for (let i = 0; i < name.length; i++) mix(name.charCodeAt(i) & 0xff);
      mix(0);
      for (const b of files.get(name)!) mix(b);
      mix(0);
    }
    return h >>> 0;
  };

  it(`${REAL_ENTRIES} tệp, ${REAL_BYTES.toLocaleString('vi-VN')} byte — con số, để một gói đọc hụt không lặng lẽ qua`, () => {
    const files = readReal();
    expect(files.size).toBe(REAL_ENTRIES);
    let total = 0;
    for (const b of files.values()) total += b.byteLength;
    expect(total).toBe(REAL_BYTES);
  });

  it('vân tay nội dung — để một byte đổi mà độ dài không đổi cũng không lặng lẽ qua', () => {
    expect(
      fingerprint(readReal()),
      'nội dung gói mẫu đã đổi. Nếu là cố ý: đóng gói lại, chạy `make courses`, rồi cập nhật ' +
        'REAL_BYTES và REAL_FNV1A theo số ĐO ĐƯỢC. Nếu không cố ý: `courses/` đang lệch khỏi ' +
        'fixtures/courses/so-dau-phay-dong.zip.',
    ).toBe(REAL_FNV1A);
  });

  it(`pack → unpack khớp TỪNG BYTE cho cả ${REAL_ENTRIES} tệp`, () => {
    const files = readReal();
    const zip = packZip(files);
    expect(zip.byteLength).toBeLessThan(files.size === 0 ? 1 : REAL_BYTES); // thật sự có nén
    const back = unpackZip(zip);
    expect([...back.keys()]).toEqual([...files.keys()].sort());
    for (const [name, bytes] of files) {
      const got = back.get(name);
      expect(got, name).toBeDefined();
      expect(got!.byteLength, name).toBe(bytes.byteLength);
      expect(got!.every((v, i) => v === bytes[i]), `${name} khác byte`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// `src/node-test-env.d.ts` khai `node:fs` cho khối test ở trên, và một khai báo
// module môi trường thì CẢ dự án nhìn thấy. Bịt lại từ bên ngoài.
// ---------------------------------------------------------------------------

it('mã ĐƯỢC SHIP không import "node:" — d.ts của test đã mở cửa đó', () => {
  const decoder = new TextDecoder('utf-8');
  for (const f of ['src/zip.ts', 'src/validate.ts', 'src/types.ts', 'src/index.ts']) {
    expect(decoder.decode(readFileSync(f)).includes("'node:"), f).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// Trợ giúp.
// ---------------------------------------------------------------------------

/**
 * Byte thật của một kho do công cụ ngoài đóng, đọc từ `fixtures/`.
 *
 * vitest chạy với cwd = `packages/course-format` (xem Makefile: test-format).
 * Lệnh sinh ra từng tệp được ghi tại ca dùng nó; không tệp nào được viết bằng
 * tay, vì một bản mô phỏng chỉ chứng minh được rằng bản mô phỏng đọc được.
 */
function fixture(name: string): Uint8Array {
  return readFileSync(`fixtures/${name}`);
}

/**
 * Từng byte một, đúng như `fflate.strFromU8(bytes, true)` giải mã tên trong
 * local header khi bit 11 tắt — KHÔNG phải windows-1252.
 */
function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Một u32 little-endian, để một ca test khẳng định được fixture nó nghĩ mình có. */
function u32le(b: Uint8Array, at: number): number {
  return (
    (((b[at] as number) | ((b[at + 1] as number) << 8) | ((b[at + 2] as number) << 16) | ((b[at + 3] as number) << 24)) >>>
      0)
  );
}

/**
 * Chèn `junk` vào GIỮA bản ghi cuối của mục lục và bản ghi EOCD.
 *
 * Trường độ dài chú thích của EOCD không đổi và vẫn chạm đúng cuối tệp, số mục
 * vẫn khớp, local header còn nguyên — nên đây là chỗ duy nhất còn lại để giấu
 * byte, và cũng đúng chỗ một cặp zip64 EOCD + locator nằm.
 *
 * Chỉ dùng cho kho `packZip` sinh ra: chúng không có chú thích, nên EOCD là 22
 * byte cuối.
 */
function spliceBeforeEocd(zip: Uint8Array, junk: Uint8Array): Uint8Array {
  const eocd = zip.length - 22;
  const out = new Uint8Array(zip.length + junk.length);
  out.set(zip.subarray(0, eocd), 0);
  out.set(junk, eocd);
  out.set(zip.subarray(eocd), eocd + junk.length);
  return out;
}

/** Bắt `UnsafeArchiveError` và bắt cả việc KHÔNG có gì được ném. */
function catchUnsafe(fn: () => unknown): UnsafeArchiveError {
  try {
    fn();
  } catch (e) {
    if (e instanceof UnsafeArchiveError) return e;
    throw e;
  }
  throw new Error('không có gì được ném');
}

/**
 * Một zip dựng bằng `fflate.Zip` trực tiếp, để làm được những kho mà `packZip`
 * cố ý không làm được: hai mục trùng tên, mục lưu nguyên (stored), mục 0 byte
 * mang tên thư mục.
 */
function rawZip(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const z = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  for (const [name, bytes] of entries) {
    const f = new ZipPassThrough(name);
    f.mtime = Date.UTC(1985, 0, 1);
    z.add(f);
    f.push(bytes, true);
  }
  z.end();
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) out.set(p, at), (at += p.length);
  return out;
}

/**
 * Đổi tên một mục TRONG MỤC LỤC mà không chạm vào local header của nó — tức là
 * dựng ra một kho mà hai nửa nói khác nhau.
 *
 * Bắt buộc cùng độ dài tên: giữ nguyên mọi offset trong kho, nên phép vá không
 * thể làm kho hỏng theo cách nào khác, và số mục vẫn khớp. Ném nếu không đúng
 * một bản ghi được sửa — một helper vá hụt sẽ làm ca test xanh vì lý do sai.
 */
function renameInCentralDirectory(zip: Uint8Array, from: string, to: string): Uint8Array {
  const f = enc(from);
  const t = enc(to);
  if (f.length !== t.length) throw new Error('renameInCentralDirectory: hai tên phải cùng số byte');
  const out = zip.slice();
  let patched = 0;
  for (let i = 0; i + 46 <= out.length; i++) {
    // "PK\x01\x02" — một bản ghi trong mục lục.
    if (out[i] !== 0x50 || out[i + 1] !== 0x4b || out[i + 2] !== 0x01 || out[i + 3] !== 0x02) continue;
    if (((out[i + 28] as number) | ((out[i + 29] as number) << 8)) !== f.length) continue;
    if (!f.every((b, k) => out[i + 46 + k] === b)) continue;
    out.set(t, i + 46);
    patched++;
  }
  if (patched !== 1) throw new Error(`renameInCentralDirectory: vá ${patched} bản ghi, cần đúng 1`);
  return out;
}

/** Vị trí mọi chữ ký local file header ("PK\x03\x04") trong kho. */
function localHeaderOffsets(zip: Uint8Array): number[] {
  const at: number[] = [];
  for (let i = 0; i + 4 <= zip.length; i++) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x03 && zip[i + 3] === 0x04) at.push(i);
  }
  return at;
}

/**
 * Một kho có ĐÚNG một mục bung ra `bytes` byte, nén theo dòng nên chính bài
 * test không bao giờ giữ `bytes` byte trong bộ nhớ — và, quan trọng hơn, mục
 * dùng data descriptor nên local header KHÔNG mang kích thước giải nén.
 */
function streamedBomb(name: string, bytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const z = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  const f = new ZipDeflate(name, { level: 1 });
  f.mtime = new Date(1985, 0, 1).getTime();
  z.add(f);
  const CHUNK = 1 << 20;
  const zeros = new Uint8Array(CHUNK);
  let left = bytes;
  while (left > CHUNK) {
    f.push(zeros, false);
    left -= CHUNK;
  }
  f.push(zeros.subarray(0, left), true);
  z.end();
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) out.set(p, at), (at += p.length);
  return out;
}

/**
 * Ghi đè trường "uncompressed size" (4 byte, offset 22) của MỌI local header
 * trong kho. Local header là thứ `fflate.Unzip` đọc khi giải nén theo dòng.
 */
function lieAboutUncompressedSize(zip: Uint8Array, claim: number): Uint8Array {
  const out = zip.slice();
  for (let i = 0; i + 30 <= out.length; i++) {
    if (out[i] === 0x50 && out[i + 1] === 0x4b && out[i + 2] === 0x03 && out[i + 3] === 0x04) {
      out[i + 22] = claim & 0xff;
      out[i + 23] = (claim >>> 8) & 0xff;
      out[i + 24] = (claim >>> 16) & 0xff;
      out[i + 25] = (claim >>> 24) & 0xff;
    }
  }
  return out;
}
