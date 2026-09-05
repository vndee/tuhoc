# Across the Noise — đặc tả 12 lab

Phụ lục của [bản thiết kế Số 02](2026-09-05-across-the-noise-design.md). Đây là hợp đồng để triển khai sau khi duyệt, không phải code đã chạy. Thứ tự tương ứng `scene-01` đến `scene-12`.

## Quy ước chung

- Mọi thông số không có đơn vị lịch sử được ghi “đơn vị mô phỏng / simulation units”. Dataset địa hình là dữ liệu tác giả tự thiết kế.
- Mỗi lab có Predict → Try → Observe → Explain; phần Predict là lựa chọn tùy ý, không chặn chạy hoặc chấm điểm con người.
- Input hợp lệ mới chạy; luôn có Reset lab, Back to illustration, và ví dụ đọc tĩnh tương đương khi module lỗi.
- Mọi ngẫu nhiên dùng seed hiển thị được và tái lập được. Đề xuất Mulberry32 seed uint32, default20260905 và counter0; đổi language, đóng/mở hoặc render lại không sinh seed mới. Chỉ nút “Đổi mẫu nhiễu / New noise sample” làm điều đó; riêng lab07 Draw tăng counter để rút kết quả tiếp theo.
- BSC dùng mảng uniform `u[i]` từ seed và lật bit nếu `u[i] < p`. Vì vậy cùng seed và p tăng có tập lỗi bao hàm. Kiểm tra xác suất chỉ đúng với mô hình lật bit độc lập, không áp sang burst hoặc nhiễu waveform.
- Thông điệp UTF-8 tối đa 1.024 byte. Chỉ render cửa sổ 64 bit và phân trang; tổng thống kê vẫn tính toàn bộ payload. Không tạo hàng chục nghìn DOM nodes.
- Decode UTF-8 chế độ strict. Byte không hợp lệ hiện hex và nhãn lỗi; không đổi thành dấu thay thế rồi báo thành công.
- Status gồm câu chữ + icon. Khác màu không là cách duy nhất báo lỗi. `aria-live` chỉ cập nhật sau thao tác hoặc batch, không đọc từng bit.

| Copy VI | Copy EN |
|---|---|
| Tự tay thử | Try it yourself |
| Chạy thử | Run experiment |
| Từng bước | Step through |
| Đặt lại lab | Reset lab |
| Trở lại tranh | Back to illustration |
| Kết quả của câu trước | Result for the previous message |
| Dữ liệu mô phỏng, không phải số đo lịch sử | Simulated data, not historical measurements |
| Ví dụ tĩnh; đây không phải kết quả lần thử của bạn | Static example; this is not your experiment result |
| Không thể giải mã thành văn bản UTF-8 hợp lệ | Cannot decode as valid UTF-8 text |

## Lab 01 — Giữ lời, bớt chữ / Keep the Meaning, Shorten the Message

**Kind:** `message-budget`. **Nguồn:** `morse-archive`, `unicode-segmentation`.

- **Instruction VI:** “Viết một câu, rồi thử rút gọn nó trong giới hạn ký tự. So sánh điều còn lại với điều bạn muốn nói.”
- **Instruction EN:** “Write a message, then shorten it to fit the character budget. Compare what remains with what you meant.”
- **Mục tiêu:** trải nghiệm biên tập có thể mất ý; phân biệt với lossless compression ở lab 08.
- **Input:** thông điệp gốc tối đa 120 grapheme/1.024 byte; bản rút lời độc lập; ngân sách 15/30/60 grapheme, default 30. Có trường gõ và nút Use example, không bắt nhập dữ liệu riêng.
- **Output:** số grapheme, byte UTF-8 và phần vượt ngân sách; so sánh nguyên văn và bản rút lời. Diff chỉ theo grapheme; không gán điểm bảo toàn ý nghĩa.
- **State:** draft và commit theo message session. Chỉnh bản rút lời không sửa original. Thay original invalidates revision; không xoá snapshot cũ không báo trước.
- **Phản hồi:** “Câu đã vừa giới hạn. Bạn có bỏ mất điều gì không?” / “It fits the budget. Did anything important disappear?” Không dùng “nén thành công”.
- **Kiểm chứng:** `ắ` và dạng a + dấu ghép nhìn tương đương đếm một grapheme nhưng byte có thể khác; emoji gia đình không bị cắt; IME và paste vượt hạn giữ draft, không cắt im lặng; mẫu EN không ghi đè câu VI đã nhập.
- **Fallback:** cùng một câu và hai bản rút gọn in cạnh nhau, người đọc tự cân nhắc phần ý bị mất.

## Lab 02 — Cùng một dấu, mấy cách đọc? / One Signal, Several Readings

**Kind:** `ambiguous-code`. **Nguồn:** `morse-tape`, `huffman-1952`.

- **Instruction VI:** “Đặt mã cho A, B, C, D. Gửi một chuỗi rồi xem người nhận có thể đọc theo những cách nào.”
- **Instruction EN:** “Assign codes to A, B, C and D. Send a sequence and inspect the receiver’s possible readings.”
- **Input:** 4 ký hiệu trung tính, codeword binary 1–6 bit; thông điệp mẫu tối đa 6 ký hiệu. Mẫu đầu A=0, B=01, C=1, D=11; gửi B.
- **Engine:** mã hoá nối codeword; giải mã bằng duyệt mọi phân đoạn hợp lệ, không greedy. Chuỗi đầu `01` có hai cách `B` và `AC`. Empty codeword, ký tự không phải 0/1 bị chặn. Code trùng vẫn được thử để nhìn thấy sự nhập nhằng.
- **Output:** cây phân đoạn, danh sách kết quả và tổng số đường giải mã. Có thể tính count bằng DP; chỉ render 32 kết quả đầu, ghi rõ phần bị ẩn. Không nhầm một prefix collision với việc MỌI chuỗi đều nhập nhằng.
- **Thao tác:** sửa từng mã, chọn ký hiệu bằng nút, gửi lại, áp ví dụ prefix-free A=00/B=01/C=10/D=11.
- **Phản hồi:** “Có 2 cách đọc hợp lệ; người nhận thiếu quy ước để chọn.” / “There are 2 valid readings; the receiver lacks a rule for choosing.”
- **Kiểm chứng:** hai cách đọc `01`; mẫu fixed-length đọc duy nhất; payload không tách được hiện 0 cách đọc; giới hạn render không sai tổng count.
- **Fallback:** cây `01 → B` và `01 → A,C`, bảng mã hoàn chỉnh; tên A/B/C/D không đổi theo language.

## Lab 03 — Đọc cả khoảng lặng / Reading the Gaps

**Kind:** `morse-spacing`. **Nguồn:** `itu-morse`, `morse-tape`.

- **Instruction VI:** “Giữ nguyên các dấu chấm và gạch. Thay khoảng nghỉ để xem thông điệp đổi cách phân đoạn.”
- **Instruction EN:** “Keep the dots and dashes unchanged. Change the pauses to see how the message is segmented.”
- **Input:** chọn `ET`, `AET`, `BEAM`, `BEAM ET`; letter gap 1–7 units, word gap 1–9; preset `BEAM ET` dùng để thử word gap. Không chuyển thông điệp tiếng Việt sang ASCII.
- **Mô hình:** modern International Morse; dot=1, dash=3, intraletter=1, default interletter=3, word=7. Decoder sư phạm: gap <2 cùng chữ, 2≤gap<5 ngăn chữ, ≥5 ngăn từ. Các ngưỡng decoder là lựa chọn của lab, không là toàn bộ tiêu chuẩn vận hành ITU.
- **Output:** dải mark/space có số duration, chữ suy ra và bảng đoạn. Khi ET có gap 3 đọc E,T; gap 1 đọc A. Không dùng SOS vì dạng distress prosign có quy ước riêng.
- **Phản hồi:** “Dấu không đổi, cách chia chữ đã đổi.” / “The marks stayed the same; the letter boundaries changed.”
- **A11y:** điều chỉnh bằng select/number buttons; SVG có bảng text. Không audio mặc định. Nếu thêm nghe thử sau này, opt-in và luôn có Stop; không cần nghe để giải lab.
- **Kiểm chứng:** preset chuẩn round-trip; ET→A khi gap1; word separator; không bịa codeword cho ký tự unsupported.
- **Fallback:** hai timeline của ET/A ghi rõ duration và kết quả; mô hình hiện đại, không mô phỏng nguyên bản năm 1844.

## Lab 04 — Chọn một đường qua biển / Choosing a Route Across the Sea

**Kind:** `cable-route`. **Nguồn:** `cable-history`, `cable-object`, `cable-workers`.

- **Instruction VI:** “So sánh ba tuyến giả lập. Chọn tuyến phù hợp ngân sách rồi kiểm tra bạn đang đánh đổi điều gì.”
- **Instruction EN:** “Compare three fictional routes. Choose one within budget and inspect its trade-offs.”
- **Dataset:** ba tuyến cố định có mặt cắt và đoạn đi qua: North L=11,H=2,D=4; Middle L=9,H=5,D=1; South L=13,H=1,D=2. L là chiều dài quy ước, H số đoạn khó, D số đoạn sâu; không phải km, ngày hoặc tiền thật.
- **Model:** C=L+4H+2D. Chi phí lần lượt 27/31/21 units. Budget default 28, chỉnh 15–40. Timeline “Xem từng đoạn” cộng các thành phần, không ngẫu nhiên gãy cáp theo một xác suất lịch sử bịa đặt.
- **Output:** độ dài, đoạn khó/sâu, bảng thành phần chi phí và đủ/thiếu budget. Vẽ profile địa hình, không chart vô nghĩa bên cạnh tranh.
- **Phản hồi:** “Tuyến ngắn nhất chưa phải tuyến ít tốn nguồn lực nhất trong mô hình này.” / “The shortest route is not the least resource-intensive route in this model.”
- **Giới hạn:** bài tập quyết định với hàm chi phí được công khai; không tối ưu tuyến cáp thật, không tính môi trường/chính trị như các số đã biết.
- **Kiểm chứng:** C chính xác 27/31/21; budget=21 vừa đủ South; chỉnh budget không đổi địa hình; 3 tuyến chọn được bằng keyboard/radio.
- **Fallback:** bản đồ và bảng ba phương án với công thức chi phí đầy đủ.

## Lab 05 — Xung còn nhận ra nhau không? / Can the Pulses Still Be Distinguished?

**Kind:** `pulse-channel`. **Nguồn:** `mit-isi`, `cable-object`.

- **Instruction VI:** “Tăng tốc gửi mà giữ nguyên kênh. Quan sát thời điểm các xung bắt đầu làm khó người nhận.”
- **Instruction EN:** “Send faster through the same channel. Observe when neighboring pulses become harder to distinguish.”
- **Input:** mẫu bit xen kẽ hoặc cửa sổ byte thông điệp; symbol duration T∈{1,2,4}; tau∈{0,0.5,1,2}; sample fraction∈{0.25,0.5,0.75}. Time unit giả lập, dt=1/16.
- **Model:** NRZ 0→−1, 1→+1; y0=0; a=1−exp(−dt/tau); y[n]=(1−a)y[n−1]+a*x[n]. tau0 bypass chính xác. Lấy mẫu theo lựa chọn, threshold0. Không có noise ngẫu nhiên ở đây.
- **Output:** input/output waveform, thời điểm lấy mẫu, quyết định bit và số lỗi trong cửa sổ. Thay T không âm thầm thay tau. Dữ liệu sample-point thật tạo SVG và bảng truy cập được.
- **Giới hạn:** bộ lọc một cực để thấy memory/ISI; không là mô hình định lượng tuyến cáp lịch sử. Kết quả phụ thuộc mẫu bit; không hứa tăng tốc luôn gây lỗi mọi chuỗi.
- **Phản hồi:** “Kênh còn giữ dấu vết của xung trước.” / “The channel still carries a trace of the previous pulse.”
- **Kiểm chứng:** tau0 đọc đúng; zero/one/alternating đều xác định; không NaN ở tau0; cùng config cùng waveform; kiểm thử sample time không vượt cửa sổ.
- **Fallback:** cùng chuỗi, T chậm/nhanh, sample table; hiển thị input/output riêng bằng nét và nhãn, không chỉ màu.

## Lab 06 — Một câu qua kênh nhiễu / A Message Through Noise

**Kind:** `binary-noise`. **Nguồn:** `shannon-1948`, `ibm-repetition`.

- **Instruction VI:** “Chọn mức nhiễu rồi truyền câu của bạn. Kiểm tra chính xác những bit nào đã đổi.”
- **Instruction EN:** “Choose a noise level and transmit your message. Inspect exactly which bits changed.”
- **Input:** UTF-8 message; BSC p=0…0.5 step0.01, default0.05; seed default20260905. Nút Manual mode cho lật bit trực tiếp, tách khỏi giả định BSC.
- **Output:** số bit đổi/N, BER quan sát, hex và decode strict; byte equality quyết định “nhận đúng dữ liệu”, không chỉ so sánh số ký tự. Mức p là xác suất cấu hình, không là tỷ lệ lỗi bắt buộc trong mỗi lần.
- **Phản hồi:** “Lần này đổi {errors}/{bits} bit.” / “This run changed {errors}/{bits} bits.” Decode lỗi có thể xảy ra mà vẫn xem hex được.
- **Kiểm chứng:** p0 byte-exact; cùng seed+p cùng mask; p tăng dùng cùng u[i]; manual flip hai lần trả gốc; invalid UTF-8 không hiện thành công.
- **Fallback:** ví dụ byte gốc, một bit lật và byte nhận; không gọi lỗi dữ liệu là “máy hiểu nhầm”.

## Lab 07 — Đo một nguồn bất ngờ / Measuring an Uncertain Source

**Kind:** `source-entropy`. **Nguồn:** `shannon-1948`, `mit-capacity`.

- **Instruction VI:** “Thay tần suất bốn ký hiệu. Dự đoán ký hiệu tiếp theo và quan sát độ bất định của cả nguồn.”
- **Instruction EN:** “Change the frequencies of four symbols. Predict the next symbol and observe the uncertainty of the source.”
- **Input:** weights A/B/C/D integers0…100; default25/25/25/25; normalize by sum. All zero là form error, không tự sửa. Một lượt Draw lấy một mẫu từ seed/counter cố định, không chấm khả năng tư duy.
- **Model:** H=−Σp log2 p; 0log0=0. Unit bits/source-symbol; giả định draws độc lập từ phân phối đã chọn. Không lấy entropy vài byte của một câu làm thước đo ngữ nghĩa toàn văn.
- **Output:** probabilities, phần đóng góp từng ký hiệu, H, symbol vừa rút; surprise=−log2 p(symbol) cho kết quả hợp lệ, không Infinity ở ký hiệu xác suất0 không thể rút.
- **Phản hồi:** “Độ bất định thay đổi; giá trị của điều được nói chưa được đo.” / “The uncertainty changed; the value of what was said was not measured.”
- **Kiểm chứng:** [1,0,0,0]→H0; [1,1,0,0]→H1; [1,1,1,1]→H2; bounds0…2; nhân mọi weight cùng hệ số không đổi H. Chuẩn hoá kết quả zero thành +0 để UI/test không trả `-0` do phép đổi dấu số thực.
- **Fallback:** phân phối đều và suy biến, bảng đóng góp, không chỉ một số lớn.

## Lab 08 — Ít bit hơn, vẫn đủ chữ / Fewer Bits, Every Character Preserved

**Kind:** `huffman-message`. **Nguồn:** `huffman-1952`, `unicode-normalization`.

- **Instruction VI:** “Ghép các nhóm byte ít gặp trước. So sánh dữ liệu trước và sau nén, tính cả bảng mã cần gửi.”
- **Instruction EN:** “Merge the least frequent byte groups first. Compare sizes before and after encoding, including the codebook.”
- **Input:** UTF-8 bytes của message; chế độ Step/Complete, tối đa256 leaf. Tree view cửa sổ có list thay thế; không giả một grapheme tiếng Việt bằng một byte.
- **Engine:** min-heap count; tie break theo byte nhỏ nhất trong subtree rồi creation order. Merge ít nhất hai node; left0/right1. Single-symbol dùng code0 độ dài1. Decoder được tạo chỉ từ header được gửi, không lấy cây bí mật của encoder.
- **Container sư phạm:** alphabet count uint16 + original byte length uint16 + payload bit length uint32 + mỗi leaf (byte uint8, count uint16) + bit payload, zero-pad đến byte. Header H=64+24k bits, container H+8*ceil(payloadBits/8). Tất cả integer big-endian; k≤256, original≤1024. Validate sum count, padding và payload length. Không gọi đây là ZIP/gzip hay định dạng tiêu chuẩn.
- **Output:** raw UTF-8 body bits, coded payload bits, header bits, padding bits, total; exact byte round-trip. Rút số bit body nhưng total tăng vẫn phải báo tăng.
- **Kiểm chứng:** `AAAA` body4 bits, header88, pad4, total96 bits so với raw32; single-symbol, equal-frequency tie, tiếng Việt/emoji; hỏng header bị từ chối; decoder không được truy cập source text.
- **Phản hồi:** “Phần dữ liệu ngắn hơn, nhưng cả gói dài hơn vì bảng mã.” / “The payload is shorter, but the full packet is larger because of its codebook.”
- **Fallback:** cây bốn byte, bảng code/length và phép cộng tổng dung lượng.

## Lab 09 — Thử gửi ba lần / Trying Three Copies

**Kind:** `repetition-channel`. **Nguồn:** `mit-code`, `ibm-repetition`.

- **Instruction VI:** “So sánh gửi mỗi bit một lần và ba lần. Kiểm tra cái giá của việc biểu quyết.”
- **Instruction EN:** “Compare sending each bit once and three times. Inspect the cost of majority voting.”
- **Engine:** mỗi bit b thành bbb liên tiếp; majority sau BSC. Không phải ba mạng độc lập. Đường uncoded dùng cùng payload và cùng seed, nhưng không tuyên bố số flip bằng nhau vì channel uses khác.
- **Output:** channel uses N hoặc3N, errors before/after decoding, payload BER, observed effective correct bits/use. Lý thuyết independent model: Pdecoded-error=3p²−2p³, label riêng với quan sát. Rate=1 hoặc1/3.
- **Burst mode:** cho chọn start index và length của một đoạn lật liên tiếp; không dùng công thức i.i.d. cho trường hợp này. Cùng tổng số lỗi nhưng phân bố khác có thể đổi kết quả.
- **Kiểm chứng:** 000→100 decode0; 000→110 decode1; 111→101 decode1; 3N; p0 nguyên vẹn; manual chunk không vượt mảng; p0.5 lý thuyết0.5.
- **Phản hồi:** “Bạn đã dùng thêm kênh để tạo cơ hội sửa lỗi, không phải để thêm ý nghĩa.” / “You used more channel resources to help correct errors, not to add meaning.”
- **Fallback:** hai khối một/ba bit, một lỗi và hai lỗi để thấy cả thành công lẫn thất bại.

## Lab 10 — Tìm vị trí cần sửa / Locating the Bit to Repair

**Kind:** `secded-inspector`. **Nguồn:** `hamming-1950`, `mit-code`.

- **Instruction VI:** “Tạo một khối bốn bit. Lật một hoặc hai bit trong khối được bảo vệ rồi đọc các phép kiểm tra.”
- **Instruction EN:** “Create a four-bit block. Flip one or two bits in its protected form and read the parity checks.”
- **Data layout 1-based:** p1,p2,d1,p4,d2,d3,d4,p0; even parity; p0 làm parity toàn8bit. Sample d=1011 → codeword01100110. Bit buttons keyboard có nhãn vị trí, data/parity và giá trị.
- **Decode:** syndrome từ checks1/2/4 trên vị trí1…7, t=xor toàn8. (s0,t0): không báo lỗi; (s≠0,t1): flip vị trí s; (s0,t1): flip8; (s≠0,t0): phát hiện lỗi kép, không nhận dữ liệu. UI tách trạng thái thuật toán báo với so sánh ground truth của simulator.
- **Giới hạn:** bảo đảm với ≤2 bit flips/word: sửa1, phát hiện2. Cho advanced mode≥3 để thấy có thể sửa nhầm/không phát hiện; tuyệt đối không gọi (s0,t0) là “chắc chắn không lỗi”. Không bảo vệ header, insertion/deletion hoặc mọi packet.
- **Output:** từng check, syndrome, quyết định, expected-vs-recovered; không chỉ đổi màu bit mà không giải thích.
- **Kiểm chứng vét cạn:** 16 payload × (1 zero-mask +8 single masks +28 double masks)=592 cases; toàn single sửa đúng, toàn double bị từ chối. Thêm mask3/mask4 làm counterexample cho giới hạn.
- **Phản hồi:** “Phát hiện hai lỗi; khối này không được chấp nhận.” / “Two errors detected; this block is not accepted.”
- **Fallback:** codeword1011 sample ở trên, check groups và ví dụ1/2 lỗi, legend truy cập được.

## Lab 11 — Chọn cách gửi trong một giới hạn / Sending Within a Budget

**Kind:** `channel-budget`. **Nguồn:** `mit-capacity`, `mit-code`, `shannon-1948`.

- **Instruction VI:** “Chọn ngân sách truyền, mức nhiễu và một mã. So sánh tốc độ hữu ích với khả năng nhận lại đúng câu.”
- **Instruction EN:** “Choose a transmission budget, noise level and code. Compare useful rate with exact message recovery.”
- **Input:** byte UTF-8 CHƯA NÉN; codes raw(k1,n1), repeat3(k1,n3), SECDED(k4,n8), default raw; p0…0.5, default0.05; budget512…32768 channel uses step512, default4096. Một use mang một bit trong mô hình. Không mô phỏng ACK, header errors hoặc retransmission.
- **Budget:** inputN=8*byteLength; required=ceil(N/k)*n. Không đủ thì không cắt đuôi rồi báo thành công. Hiện max payload capacity floor(B/n)*k và số use còn thiếu. Vì UTF-8 byte-aligned, SECDED không cần padding data ở đây.
- **Run:** gửi một lần với seed, decode, lưu immutable receipt có revision+source bytes+config+outcome. SECDED reject bất cứ block nào → receipt rejected. Nếu thuật toán accept nhưng byte khác: simulator ghi “chấp nhận sai”, không che dưới label delivered.
- **Compare batch:** 200 trials, cùng danh sách seed cho 3 codes; mỗi code đủ budget mới so sánh. Hiện sample count, exact-message successes, detected rejects, silent corruption và empirical BER khi có output. Không bịa confidence interval. Batch chạy chủ động, yield mỗi chunk và Cancel; không làm 600 tests khi người chỉ scroll.
- **Theory panel:** BSC capacity C=1−Hb(p), bits/use; raw rate1, repeat1/3, SECDED1/2. R<C không đảm bảo ba mã ngắn này đạt reliable transmission; R≥C không nghĩa mọi message đơn lẻ đều thất bại. Theorem là giới hạn tiệm cận dưới giả định đã nêu, không phải kết quả batch200.
- **Kiểm chứng:** budget đúng boundary; p0 toàn codes round-trip; seed replay; C0=1,C0.5=0; stale receipt sau edit; đếm successes+rejects+silent=200; Cancel không publish partial batch như complete.
- **Fallback:** bảng ba mã với overhead/rate/budget và ví dụ có nhãn; không tạo receipt giả.

## Lab 12 — Cùng câu ấy, những cách hiểu khác / The Same Words, Different Readings

**Kind:** `message-meaning`. **Nguồn:** `shannon-1948`, `morse-archive`.

- **Instruction VI:** “Đối chiếu câu gửi và câu nhận. Sau đó đổi bối cảnh, nhưng giữ nguyên những chữ ấy.”
- **Instruction EN:** “Compare the sent and received message. Then change the context while keeping its words unchanged.”
- **Data:** receipt đúng revision từ11. Chưa có: “Bạn chưa chạy lần truyền nào cho câu này.” / “You have not transmitted this message in this experiment.” Có link tới11 và ví dụ tĩnh riêng, không bắt phải đi hết các lab.
- **Output kỹ thuật:** byte-exact, corrupted, rejected, stale hoặc not-run; bản original/received và details. Không có AI suy luận ý định.
- **Ngữ cảnh hư cấu:** C1 cuộc hẹn thường ngày / an ordinary meeting; C2 hai người vừa bất đồng / after a disagreement; C3 người nhận thiếu câu trước / the receiver missed the preceding message. Người đọc chọn “cách hiểu của tôi có đổi/không/chưa rõ”, được bỏ qua. Không chấm đúng sai hay gán sentiment.
- **Thao tác:** đổi context không đổi receipt, message bytes hay delivery status. Có nút tách riêng “Thử lại với câu khác” mở editor, không ghi đè tự động.
- **Phản hồi:** “Chúng ta kiểm tra được dữ liệu có khớp. Bài thử này không đo được hai người đã hiểu nhau đến đâu.” / “We can check whether the data matches. This experiment does not measure how well two people understand each other.”
- **Kiểm chứng:** deep link12 không báo delivered; scene11 fail không xanh; revision mismatch stale; language switch giữ data; contexts không làm fetch hoặc auto-translate; lựa chọn cách hiểu không là telemetry.
- **Fallback:** hai bản cùng một câu mẫu và ba context, rõ nhãn hư cấu/ví dụ; coda vẫn đọc được khi lab chưa chạy.

## Kết luận về độ chính xác

Các công thức, bảng và fixture trên là tiêu chí cho tests tương lai, không thay một lần chạy engine. Sau khi triển khai cần kiểm tra model độc lập với UI, rồi kiểm tra UI hiển thị đúng kết quả model và giới hạn. Không suy ra chất lượng đường truyền thật từ những mô phỏng này.
