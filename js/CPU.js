var config;
var utils;
var ui;
var CPU;
var HDL;

var CPU = (function() {
	console.log("loading CPU module");
	var conf;
	
	var has_power = false;
	var cycles;
	
	var load_queue;
	var store_queue;
	var RS_add;
	var RS_mul;
	var FP_regs;
	var INT_regs;
	
	var memory;
	var instructions;
	
	var ui_ele;
	
	var PC;
	
	var memory_controller;
	var FP_adder;
	var FP_multiplier;
	var FP_divider;
	
	var WB_name;
	var WB_value;
	
	
	// TODO : drag these to config file
	// hardcoded memory size : 4096
	const mem_size = 4096;
	const mem_bits = 12;
	
	
	var get_memory_module = () => {
		// memory submodule ...
		
		var mem;
		
		var do_load = () => {
			mem = [];
			mem.length = mem_size;
		};
		
		// init from config
		var do_initialize = () => {
			for (var i = 0; i < mem_size; i++) {
				mem[i] = {
					value : 0.0,
					modified : false,
					signal : undefined
				};
			}
			
			// load vals from config
			var values_list = conf.mem_vals.trim().split("\n");
			values_list.forEach((s) => {
				var tmp = s.trim().split(" ");
				var addr = parseInt(tmp[0]);
				var val = parseFloat(tmp[1]);
				if (isNaN(addr) || isNaN(val)) return;
				if (addr < 0 || addr >= mem_size) return;
				
				mem_write(addr, val);
			});
		};
		
		var mem_write = (addr, val) => {
			// write memory
			
			if (addr < 0 || addr >= mem_size) {
				throw "invalid addr " + addr;
			}
			
			if (!mem[addr].modified) {
				// add this entry to ui
				
				mem[addr].modified = true;
				add_entry(addr);
			}
			
			mem[addr].value = val;
			mem[addr].signal.set(val);
		};
		
		var mem_read = (addr) => {
			// read memory
			
			return mem[addr].value;
		};
		
		var add_entry = (addr) => {
			var count = 0;
			for (var i = 0; i < addr; i++) {
				count += mem[i].modified ? 1 : 0;
			}
			var e = ui.add_memory_table_entry(count);
			HDL.signal(ui.update_func(e.addr)).set(addr);
			mem[addr].signal = HDL.signal(ui.update_func(e.val));
		};
		
		return {
			do_load : do_load,
			initialize : do_initialize,
			mem_read : mem_read,
			mem_write : mem_write
		};
	};
	
	
	var get_instructions_module = () => {
		
		var ins;
		
		var do_load = () => {
			ins = [];
		};
		
		// init from config
		var do_initialize = () => {
			ins.length = 0;
			
			// load instructions from config
			var ins_list = conf.instructions.trim().split("\n");
			ins_list.forEach((s) => {
				var tmp = parse_instruction(s);
				if (!tmp) {
					alert("Invalid instruction `" + s + "`");
					return;
				}
				
				tmp.PC = ins.length;
				tmp.issue = "";
				tmp.execution = "";
				tmp.writeback = "";
				
				// add this instruction to ui
				var tr = ui.add_instruction_queue_table_entry();
				// console.log(tr);
				for (var i in tr) {
					tmp[i] = HDL.signal(ui.update_func(tr[i])).set(tmp[i]);
				}
				
				ins.push(tmp);
			});
		};
		
		var parse_int = (s) => {
			s = s.trim();
			var x = parseInt(s);
			if (x + "" != s) {
				return undefined;
			}
			return x;
		};
		
		var parse_FP_reg = (s) => {
			s = s.trim();
			if (s[0] != "F") {
				return undefined;
			}
			var id = parse_int(s.substr(1));
			if (isNaN(id)) {
				return undefined;
			}
			if (id < 0 || id >= conf.n_FP_registers) {
				return undefined;
			}
			return "F" + id;
		};
		
		var parse_INT_reg = (s) => {
			s = s.trim();
			if (s[0] != "R") {
				return undefined;
			}
			var id = parse_int(s.substr(1));
			if (isNaN(id)) {
				return undefined;
			}
			if (id < 0 || id >= conf.n_INT_registers) {
				return undefined;
			}
			return "R" + id;
		};
		
		var parse_addr = (s) => {
			s = s.trim();
			var pos_1 = s.indexOf("(");
			var pos_2 = s.indexOf(")");
			if (pos_1 == -1 || pos_2 == -1 || pos_1 > pos_2) {
				return undefined;
			}
			var offset = parse_int(s.substr(0, pos_1));
			if (isNaN(offset)) {
				return undefined;
			}
			var reg = parse_INT_reg(s.substr(pos_1 + 1, pos_2 - pos_1 - 1));
			if (!reg) {
				return undefined;
			}
			if (s.substr(pos_2 + 1).trim() != "") {
				return undefined;
			}
			return {
				offset : offset,
				reg : reg
			};
		};
		
		var parse_mem_arglist = (s) => {
			var l = s.split(",");
			if (l.length != 2) {
				return undefined;
			}
			var dest = parse_FP_reg(l[0]);
			if (!dest) {
				return undefined;
			}
			var source = parse_addr(l[1]);
			if (!source) {
				return undefined;
			}
			return {
				dest : dest,
				source : source
			};
		};
		
		var parse_arith_arglist = (s) => {
			var l = s.split(",");
			if (l.length != 3) {
				return undefined;
			}
			var dest = parse_FP_reg(l[0]);
			if (!dest) {
				return undefined;
			}
			var src1 = parse_FP_reg(l[1]);
			if (!src1) {
				return undefined;
			}
			var src2 = parse_FP_reg(l[2]);
			if (!src2) {
				return undefined;
			}
			return {
				dest : dest,
				src1 : src1,
				src2 : src2
			};
		};
		
		var parse_instruction = (s) => {
			// returns: object -- name, dest, src1, src2
			
			// (1) load / store
			{
				const names = ["LD", "ST"];
				for (var i in names) {
					var name = names[i];
					if (s.substr(0, name.length + 1) == name + " ") {
						var tmp = parse_mem_arglist(s.substr(name.length + 1));
						if (!tmp) return undefined;
						return {
							name : name,
							dest : tmp.dest,
							src1 : tmp.source.offset,
							src2 : tmp.source.reg
						};
					}
				}
			}
			
			// (2) add / sub / mul / div
			{
				const names = ["ADDD", "SUBD", "MULD", "DIVD"];
				for (var i in names) {
					var name = names[i];
					if (s.substr(0, name.length + 1) == name + " ") {
						var tmp = parse_arith_arglist(s.substr(name.length + 1));
						if (!tmp) return undefined;
						return {
							name : name,
							dest : tmp.dest,
							src1 : tmp.src1,
							src2 : tmp.src2
						};
					}
				}
			}
			
			return undefined;
		};
		
		
		var do_peek_name = () => {
			if (PC.val() >= ins.length) {
				return undefined;
			} else {
				return ins[PC.val()].name.val();
			}
		};
		
		var do_fetch = () => {
			PC.set(PC.val() + 1);
			
			var ret = ins[PC.val()];
			ret.issue.set(cycles.val());
			return ret;
		};
		
		var do_set_execution = (id) => {
			ins[id].execution.set(cycles.val());
		};
		
		var do_set_writeback = (id) => {
			ins[id].writeback.set(cycles.val());
		};
		
		return {
			do_load : do_load,
			initialize : do_initialize,
			peek_name : do_peek_name,
			fetch : do_fetch,
			set_execution : do_set_execution,
			set_writeback : do_set_writeback
		};
	};
	
	
	var CPU_exec_id = 0;
	var CPU_exec_delay_time = 1000;
	
	// HDL-like CPU clock function
	var get_CPU_clock_func = function() {
		var id = ++CPU_exec_id;
		
		var load_queue_allocate = () => {
			for (var i in load_queue) {
				if (load_queue[i].busy.val() == "No"
					|| load_queue[i].name == WB_name) {
					return load_queue[i];
				}
			}
			return undefined;
		};
		
		var store_queue_allocate = () => {
			for (var i in store_queue) {
				if (store_queue[i].busy.val() == "No"
					|| store_queue[i].name == WB_name) {
					return store_queue[i];
				}
			}
			return undefined;
		};
		
		var RS_add_allocate = () => {
			for (var i in RS_add) {
				if (RS_add[i].busy.val() == "No"
					|| RS_add[i].name == WB_name) {
					return RS_add[i];
				}
			}
			return undefined;
		};
		
		var RS_mul_allocate = () => {
			for (var i in RS_mul) {
				if (RS_mul[i].busy.val() == "No"
					|| RS_mul[i].name == WB_name) {
					return RS_mul[i];
				}
			}
			return undefined;
		};
		
		var get_reg_value = (reg, V, Q) => {
			var reg_val = reg.val();
			if ((reg_val + "") == WB_name) {
				// WB->IF fowarding
				V.set(WB_value);
				Q.set("");
			} else if (isNaN(reg_val)) {
				// in a reservation station
				V.set("");
				Q.set(reg_val);
			} else {
				// value get
				V.set(reg_val);
				Q.set("");
			}
		};
		
		var IF = () => {
			var ins_name = instructions.peek_name();
			if (!ins_name) {
				// no more instruction
				return;
			}
			
			const ins_name_to_type = {
				LD : "load",
				ST : "store",
				ADDD : "add",
				SUBD : "add",
				MULD : "mul",
				DIVD : "mul"
			};
			
			var ins_type = ins_name_to_type[ins_name];
			
			// check if possible to issue the instruction
			
			if (ins_type == "load") {
				var e = load_queue_allocate();
				if (!e) return;
				
				var ins = instructions.fetch();
				
				e.busy.set("Yes");
				e.PC.set(ins.PC.val());
				e.addr.set(ins.src1.val() + INT_regs[ins.src2.val()].val());
				FP_regs[ins.dest.val()].set(e.name);  // dest
			}
			
			if (ins_type == "store") {
				var e = store_queue_allocate();
				if (!e) return;
				
				var ins = instructions.fetch();
				
				e.busy.set("Yes");
				e.PC.set(ins.PC.val());
				e.addr.set(ins.src1.val() + INT_regs[ins.src2.val()].val());
				get_reg_value(FP_regs[ins.dest.val()], e.Vk, e.Qk);
			}
			
			if (ins_type == "add") {
				var e = RS_add_allocate();
				if (!e) return;
				
				var ins = instructions.fetch();
				
				e.busy.set("Yes");
				e.op.set(ins_name);
				e.PC.set(ins.PC.val());
				get_reg_value(FP_regs[ins.src1.val()], e.Vj, e.Qj);  // src1
				get_reg_value(FP_regs[ins.src2.val()], e.Vk, e.Qk);  // src2
				FP_regs[ins.dest.val()].set(e.name);  // dest
			}
			
			if (ins_type == "mul") {
				var e = RS_mul_allocate();
				if (!e) return;
				
				var ins = instructions.fetch();
				
				e.busy.set("Yes");
				e.op.set(ins_name);
				e.PC.set(ins.PC.val());
				get_reg_value(FP_regs[ins.src1.val()], e.Vj, e.Qj);  // src1
				get_reg_value(FP_regs[ins.src2.val()], e.Vk, e.Qk);  // src2
				FP_regs[ins.dest.val()].set(e.name);  // dest
			}
		};
		
		var EXE_load_store = () => {
			// strictly in PC order
			
			if (memory_controller.is_running.val() == true) {
				// is running
				
				var t_r = memory_controller.t_remaining.val();
				if (t_r == 1) {
					// done
					if (memory_controller.type.val() == "load") {
						// load : get XXX from mem
						var tmp = memory.mem_read(memory_controller.addr.val());
						memory_controller.value.set(tmp);
					} else {
						// store : nothing to do ...
					}
					
					// mark as done
					memory_controller.t_remaining.set(0);
					instructions.set_execution(memory_controller.PC.val());
				} else if (t_r > 1) {
					// working in progress
					memory_controller.t_remaining.set(
						memory_controller.t_remaining.val() - 1);
				}
			}
			
			// [immediately after CDB broadcast]
			if (memory_controller.is_running.val() == false ||
				memory_controller.name.val() == WB_name) {
				// not running : try to get a request from the queues
				var e = undefined;
				var check = (t) => {
					if (t.busy.val() != "Yes" || t.is_running.val() == true) {
						return;
					}
					if (!e || t.PC.val() < e.PC.val()) {
						e = t;
					}
				};
				for (var i in load_queue) check(load_queue[i]);
				for (var i in store_queue) check(store_queue[i]);
				
				if (!e) return;
				
				// load : waiting for data
				// notice that store instruction check this in WB stage
				var is_load = e.name.substr(0, 4) == "Load";
				if (is_load && e.Qk.val() != "") return;
				
				e.is_running.set(true);
				
				if (is_load) {
					memory_controller.type.set("load");
					memory_controller.value.set("");
					memory_controller.t_remaining.set(conf.t_load - 1);
				} else {
					memory_controller.type.set("store");
					if (e.Qk.val() != "") {
						memory_controller.value.set(e.Qk.val());
					} else {
						memory_controller.value.set(e.Vk.val());
					}
					memory_controller.t_remaining.set(conf.t_store - 1);
				}
				
				memory_controller.is_running.set(true);
				memory_controller.addr.set(e.addr.val());
				memory_controller.name.set(e.name);
				memory_controller.PC.set(e.PC.val());
			}
		};
		
		var EXE_add_sub = () => {
			// completely rewrite ...
			// feel awkward about pipelines
			
			// detect & run in reverse order
			// O(n) lines, O(n) latency
			
			var n = conf.t_add_sub.length;
			
			var can_advance;
			for (var i = n - 1; i >= 0; i--) {
				var FPA = FP_adder[i];
				
				var has_advanced;
				
				if (FPA.is_running.val() == true) {
					var t_r = FPA.t_remaining.val();
					
					if (i == n - 1 && t_r == 1) {
						// done
						if (FPA.type.val() == "add") {
							var tmp = FPA.src1.val() + FPA.src2.val();
							FPA.value.set(tmp);
						} else {
							var tmp = FPA.src1.val() - FPA.src2.val();
							FPA.value.set(tmp);
						}
						// mark as done
						instructions.set_execution(FPA.PC.val());
					}
					
					if (t_r > 0) {
						FPA.t_remaining.set(t_r - 1);
					}
					
					if (i < n - 1 && t_r == 0 && can_advance) {
						// advance to i + 1
						
						var FPA_next = FP_adder[i + 1];
						FPA_next.is_running.set(true);
						FPA_next.type.set(FPA.type.val());
						FPA_next.src1.set(FPA.src1.val());
						FPA_next.src2.set(FPA.src2.val());
						FPA_next.name.set(FPA.name.val());
						FPA_next.value.set(FPA.value.val());
						FPA_next.PC.set(FPA.PC.val());
						FPA_next.t_remaining.set(conf.t_add_sub[i + 1] - 1);
						// special case
						if (i == n - 2 && conf.t_add_sub[i + 1] - 1 == 0) {
							// done
							if (FPA.type.val() == "add") {
								var tmp = FPA.src1.val() + FPA.src2.val();
								FPA_next.value.set(tmp);
							} else {
								var tmp = FPA.src1.val() - FPA.src2.val();
								FPA_next.value.set(tmp);
							}
							// mark as done
							instructions.set_execution(FPA.PC.val());
						}
						
						FPA.is_running.set(false);
						FPA.type.set("");
						FPA.src1.set("");
						FPA.src2.set("");
						FPA.name.set("");
						FPA.value.set("");
						FPA.PC.set("");
						FPA.t_remaining.set("");
						
						has_advanced = true;
					} else {
						has_advanced = false;
					}
				}
				
				// can advance to stage i ?
				if (i == n - 1) {
					can_advance = !FPA.is_running.val()
						|| FPA.name.val() == WB_name;
				} else {
					can_advance = !FPA.is_running.val()
						|| has_advanced;
				}
			}
			
			if (can_advance) {
				// find a RS
				var e = undefined;
				var check = (t) => {
					if (t.busy.val() != "Yes" || t.is_running.val() == true) {
						return;
					}
					if (!e && (t.Qj.val() + "") == "" && (t.Qk.val() + "") == "") {
						e = t;
					}
				};
				for (var i in RS_add) check(RS_add[i]);
				
				if (!e) return;
				
				var is_add = e.op.val() == "ADDD";
				
				e.is_running.set(true);
				
				if (is_add) {
					FP_adder[0].type.set("add");
					
				} else {
					FP_adder[0].type.set("sub");
				}
				
				FP_adder[0].t_remaining.set(conf.t_add_sub[0] - 1);
				
				FP_adder[0].src1.set(e.Vj.val());
				FP_adder[0].src2.set(e.Vk.val());
				FP_adder[0].name.set(e.name);
				FP_adder[0].value.set("");
				FP_adder[0].is_running.set(true);
				FP_adder[0].PC.set(e.PC.val());
			}
		};
		
		var EXE_mul = () => {
			// detect & run in reverse order
			// O(n) lines, O(n) latency
			
			var n = conf.t_mul.length;
			
			var can_advance;
			for (var i = n - 1; i >= 0; i--) {
				var FPM = FP_multiplier[i];
				
				var has_advanced;
				
				if (FPM.is_running.val() == true) {
					var t_r = FPM.t_remaining.val();
					
					if (i == n - 1 && t_r == 1) {
						// done
						var tmp = FPM.src1.val() * FPM.src2.val();
						FPM.value.set(tmp);
						// mark as done
						instructions.set_execution(FPM.PC.val());
					}
					
					if (t_r > 0) {
						FPM.t_remaining.set(t_r - 1);
					}
					
					if (i < n - 1 && t_r == 0 && can_advance) {
						// advance to i + 1
						
						var FPM_next = FP_multiplier[i + 1];
						FPM_next.is_running.set(true);
						FPM_next.type.set(FPM.type.val());
						FPM_next.src1.set(FPM.src1.val());
						FPM_next.src2.set(FPM.src2.val());
						FPM_next.name.set(FPM.name.val());
						FPM_next.value.set(FPM.value.val());
						FPM_next.PC.set(FPM.PC.val());
						FPM_next.t_remaining.set(conf.t_mul[i + 1] - 1);
						// special case
						if (i == n - 2 && conf.t_mul[i + 1] - 1 == 0) {
							// done
							var tmp = FPM.src1.val() * FPM.src2.val();
							FPM_next.value.set(tmp);
							// mark as done
							instructions.set_execution(FPM.PC.val());
						}
						
						FPM.is_running.set(false);
						FPM.type.set("");
						FPM.src1.set("");
						FPM.src2.set("");
						FPM.name.set("");
						FPM.value.set("");
						FPM.PC.set("");
						FPM.t_remaining.set("");
						
						has_advanced = true;
					} else {
						has_advanced = false;
					}
				}
				
				// can advance to stage i ?
				if (i == n - 1) {
					can_advance = !FPM.is_running.val()
						|| FPM.name.val() == WB_name;
				} else {
					can_advance = !FPM.is_running.val()
						|| has_advanced;
				}
			}
			
			if (can_advance) {
				// find a RS
				var e = undefined;
				var check = (t) => {
					if (t.busy.val() != "Yes" || t.is_running.val() == true) {
						return;
					}
					if (!e && t.op.val() == "MULD" && (t.Qj.val() + "") == "" && (t.Qk.val() + "") == "") {
						e = t;
					}
				};
				for (var i in RS_mul) check(RS_mul[i]);
				
				if (!e) return;
				
				e.is_running.set(true);
				
				FP_multiplier[0].type.set("mul");
				
				FP_multiplier[0].t_remaining.set(conf.t_mul[0] - 1);
				
				FP_multiplier[0].src1.set(e.Vj.val());
				FP_multiplier[0].src2.set(e.Vk.val());
				FP_multiplier[0].name.set(e.name);
				FP_multiplier[0].value.set("");
				FP_multiplier[0].is_running.set(true);
				FP_multiplier[0].PC.set(e.PC.val());
			}
		};
		
		var EXE_div = () => {
			if (FP_divider.is_running.val() == true) {
				// is running
				// [removed some useless and buggy code]
				
				var t_r = FP_divider.t_remaining.val();
				if (t_r == 1) {
					// done
					var tmp = FP_divider.src1.val() / FP_divider.src2.val();
					FP_divider.value.set(tmp);
					
					// mark as done
					FP_divider.t_remaining.set(0);
					instructions.set_execution(FP_divider.PC.val());
				} else if (t_r > 1) {
					// WIP
					FP_divider.t_remaining.set(FP_divider.t_remaining.val() - 1);
				}
			}
			
			// [immediately after CDB broadcast]
			if (FP_divider.is_running.val() == false ||
				FP_divider.name.val() == WB_name) {
				// not running : find a ready RS
				var e = undefined;
				var check = (t) => {
					if (t.busy.val() != "Yes" || t.is_running.val() == true) {
						return;
					}
					if (!e && t.op.val() == "DIVD" && (t.Qj.val() + "") == "" && (t.Qk.val() + "") == "") {
						e = t;
					}
				};
				for (var i in RS_mul) check(RS_mul[i]);
				
				if (!e) return;
				
				e.is_running.set(true);
				
				FP_divider.type.set("div");
				FP_divider.t_remaining.set(conf.t_div - 1);
				
				FP_divider.src1.set(e.Vj.val());
				FP_divider.src2.set(e.Vk.val());
				FP_divider.name.set(e.name);
				FP_divider.value.set("");
				FP_divider.is_running.set(true);
				FP_divider.PC.set(e.PC.val());
			}
		};
		
		var EXE = () => {
			// (1) load & store
			EXE_load_store();
			
			// (2) add & sub
			EXE_add_sub();
			
			// (3) mul & div
			EXE_mul();
			EXE_div();
		};
		
		var CDB_write = (name, value) => {
			WB_name = name;
			WB_value = value;
			
			if (memory_controller.is_running.val() == true) {
				if (memory_controller.value.val() == name) {
					memory_controller.value.set(value);
				}
			}
			
			var check_load_store = (e) => {
				if (e.busy.val() == "Yes") {
					if (e.Qk.val() == name) {
						e.Qk.set("");
						e.Vk.set(value);
					}
				}
			};
			
			for (var i in load_queue) check_load_store(load_queue[i]);
			for (var i in store_queue) check_load_store(store_queue[i]);
			
			var check_RS = (e) => {
				if (e.busy.val() == "Yes") {
					if (e.Qj.val() == name) {
						e.Qj.set("");
						e.Vj.set(value);
					}
					if (e.Qk.val() == name) {
						e.Qk.set("");
						e.Vk.set(value);
					}
				}
			};
			
			for (var i in RS_add) check_RS(RS_add[i]);
			for (var i in RS_mul) check_RS(RS_mul[i]);
			
			var check_reg = (e) => {
				if (e.val() == name) {
					e.set(value);
				}
			};
			
			for (var i in FP_regs) check_reg(FP_regs[i]);
			// no need to check int regs ...
		};
		
		// returns true if succeed
		var WB_load_store = () => {
			if (memory_controller.is_running.val() == false) {
				return false;
			}
			if (memory_controller.t_remaining.val() != 0) {
				return false;
			}
			
			if (memory_controller.type.val() == "load") {
				// load : write to CDB
				CDB_write(memory_controller.name.val(),
					memory_controller.value.val());
				
				memory_controller.is_running.set(false);
				memory_controller.type.set("");
				memory_controller.addr.set("");
				memory_controller.name.set("");
				memory_controller.value.set("");
				memory_controller.t_remaining.set("");
				memory_controller.PC.set("");
				
				// update the load queue
				var e = undefined;
				var check = (t) => {
					if (t.is_running.val()) {
						e = t;
					}
				};
				for (var i in load_queue) check(load_queue[i]);
				
				e.is_running.set(false);
				e.busy.set("No");
				e.PC.set("");
				e.Vk.set("");
				e.Qk.set("");
				e.addr.set("");
				instructions.set_writeback(e.PC.val());
				
				return true;
			} else {
				// store : write to mem
				// check the requirements first
				
				if (isNaN(memory_controller.value.val())) {
					return false;
				}
				
				memory.mem_write(memory_controller.addr.val(),
					memory_controller.value.val());
				
				memory_controller.is_running.set(false);
				memory_controller.type.set("");
				memory_controller.addr.set("");
				memory_controller.name.set("");
				memory_controller.value.set("");
				memory_controller.t_remaining.set("");
				memory_controller.PC.set("");
				
				// update the load queue
				var e = undefined;
				var check = (t) => {
					if (t.is_running.val()) {
						e = t;
					}
				};
				for (var i in store_queue) check(store_queue[i]);
				
				e.is_running.set(false);
				e.busy.set("No");
				e.PC.set("");
				e.Vk.set("");
				e.Qk.set("");
				e.addr.set("");
				instructions.set_writeback(e.PC.val());
				
				return true;
			}
		};
		
		var WB_add_sub = () => {
			var n = conf.t_add_sub.length;
			var FPA_last = FP_adder[n - 1];
			
			if (FPA_last.is_running.val() == false) {
				return false;
			}
			if (FPA_last.t_remaining.val() != 0) {
				return false;
			}
			
			// add/sub : write to CDB
			CDB_write(FPA_last.name.val(), FPA_last.value.val());
			
			FPA_last.is_running.set(false);
			FPA_last.type.set("");
			FPA_last.name.set("");
			FPA_last.value.set("");
			FPA_last.t_remaining.set("");
			FPA_last.src1.set("");
			FPA_last.src2.set("");
			FPA_last.PC.set("");
			
			var e = undefined;
			var check = (t) => {
				if (t.name == FPA_last.name.val()) {
					e = t;
				}
			};
			for (var i in RS_add) check(RS_add[i]);
			
			e.is_running.set(false);
			e.busy.set("No");
			e.PC.set("");
			e.Vj.set("");
			e.Qj.set("");
			e.Vk.set("");
			e.Qk.set("");
			e.op.set("");
			instructions.set_writeback(e.PC.val());
			
			return true;
		};
		
		var WB_mul = () => {
			var n = conf.t_mul.length;
			var FPM_last = FP_multiplier[n - 1];
			
			if (FPM_last.is_running.val() == false) {
				return false;
			}
			if (FPM_last.t_remaining.val() != 0) {
				return false;
			}
			
			// mul/div : write to CDB
			CDB_write(FPM_last.name.val(), FPM_last.value.val());
			
			FPM_last.is_running.set(false);
			FPM_last.type.set("");
			FPM_last.name.set("");
			FPM_last.value.set("");
			FPM_last.t_remaining.set("");
			FPM_last.src1.set("");
			FPM_last.src2.set("");
			FPM_last.PC.set("");
			
			var e = undefined;
			var check = (t) => {
				if (t.name == WB_name) {
					e = t;
				}
			};
			for (var i in RS_mul) check(RS_mul[i]);
			
			e.is_running.set(false);
			e.busy.set("No");
			e.PC.set("");
			e.Vj.set("");
			e.Qj.set("");
			e.Vk.set("");
			e.Qk.set("");
			e.op.set("");
			instructions.set_writeback(e.PC.val());
			
			return true;
		};
		
		var WB_div = () => {
			if (FP_divider.is_running.val() == false) {
				return false;
			}
			if (FP_divider.t_remaining.val() != 0) {
				return false;
			}
			
			// mul/div : write to CDB
			CDB_write(FP_divider.name.val(), FP_divider.value.val());
			
			FP_divider.is_running.set(false);
			FP_divider.type.set("");
			FP_divider.name.set("");
			FP_divider.value.set("");
			FP_divider.t_remaining.set("");
			FP_divider.src1.set("");
			FP_divider.src2.set("");
			FP_divider.PC.set("");
			
			var e = undefined;
			var check = (t) => {
				if (t.name == WB_name) {
					e = t;
				}
			};
			for (var i in RS_mul) check(RS_mul[i]);
			
			e.is_running.set(false);
			e.busy.set("No");
			e.PC.set("");
			e.Vj.set("");
			e.Qj.set("");
			e.Vk.set("");
			e.Qk.set("");
			e.op.set("");
			instructions.set_writeback(e.PC.val());
			
			return true;
		};
		
		var WB = () => {
			WB_name = "";
			WB_value = "";
			
			// (1) load & store
			if (WB_load_store() == true) return;
			
			// (2) add & sub
			if (WB_add_sub() == true) return;
			
			// (3) mul & div
			if (WB_mul() == true) return;
			if (WB_div() == true) return;
		};
		
		var f = function() {
			if (id != CPU_exec_id) {
				return;
			}
			
			// combinational logic
			
			// (0) update cycles
			cycles.set(cycles.val() + 1);
			
			// (3) writeback
			WB();
			
			// (1) instruction fetch
			// IF needs forwarding from WB
			IF();
			
			// (2) execution
			// needs WB -> EXE forwarding for zero-latency EXE chains
			EXE();
			
			// rising edge
			HDL.rising_edge();
			
			setTimeout(f, CPU_exec_delay_time);
		};
		
		return f;
	};
	
	
	var CPU_do_load = function() {
		console.log("CPU.do_load");
		
		// load memory submodule
		memory = get_memory_module();
		memory.do_load();
		
		// load instructions submodule
		instructions = get_instructions_module();
		instructions.do_load();
		
		// 2017-06-04 @wys
		// must load config manually
	};
	
	// DANGER ! This function immediately resets all CPU states & ui
	var CPU_load_config = function(_conf) {
		if (has_power) {
			throw "ERROR: Can't set config while power on";
		}
		console.log("CPU load config ...");
		
		conf = _conf;
		
		// load config
		ui.reload_ui(conf);
		
		ui_ele = ui.get_elements();
		console.log(ui_ele);
		
		// leave HDL un-initialized
	};
	
	var CPU_power_on = function() {
		if (has_power) {
			throw "ERROR: already powered on";
		}
		console.log("CPU power on ...");
		
		has_power = true;
		
		HDL.re_init();
		
		// (0) cycles & PC
		// bug fix [2017-05-31] @wys
		cycles = HDL.signal(ui.CPU_cycles_update_func());
		cycles.set(1);  // should not be '0'
		PC = HDL.signal(ui.CPU_PC_update_func());
		PC.set(0);
		
		// (1) load queue [load by ui]
		load_queue = {};
		for (var i in ui_ele.load_queue) {
			var e = ui_ele.load_queue[i];
			load_queue[i] = {
				name : i
			};
			for (var j in e) if (j != "name") {
				load_queue[i][j] = HDL.signal(ui.update_func(e[j])).set("");
			}
			load_queue[i].busy.set("No");
			load_queue[i].is_running = HDL.signal(() => 0).set(false);
		}
		
		// (2) store queue [load by ui]
		store_queue = {};
		for (var i in ui_ele.store_queue) {
			var e = ui_ele.store_queue[i];
			store_queue[i] = {
				name : i
			};
			for (var j in e) if (j != "name") {
				store_queue[i][j] = HDL.signal(ui.update_func(e[j])).set("");
			}
			store_queue[i].busy.set("No");
			store_queue[i].is_running = HDL.signal(() => 0).set(false);
		}
		
		// (3) RS add [load by ui]
		RS_add = {};
		for (var i in ui_ele.RS_add) {
			var e = ui_ele.RS_add[i];
			RS_add[i] = {
				name : i
			};
			for (var j in e) if (j != "name") {
				RS_add[i][j] = HDL.signal(ui.update_func(e[j])).set("");
			}
			RS_add[i].busy.set("No");
			RS_add[i].is_running = HDL.signal(() => 0).set(false);
		}
		
		// (4) RS mul [load by ui]
		RS_mul = {};
		for (var i in ui_ele.RS_mul) {
			var e = ui_ele.RS_mul[i];
			RS_mul[i] = {
				name : i
			};
			for (var j in e) if (j != "name") {
				RS_mul[i][j] = HDL.signal(ui.update_func(e[j])).set("");
			}
			RS_mul[i].busy.set("No");
			RS_mul[i].is_running = HDL.signal(() => 0).set(false);
		}
		
		// (5) FP regs [load by ui]
		FP_regs = {};
		for (var i in ui_ele.FP_regs) {
			FP_regs[i] = HDL.signal(ui.update_func(ui_ele.FP_regs[i])).set(0.0);
		}
		// load FP reg vals from config
		(() => {
			var values_list = conf.FP_reg_vals.trim().split("\n");
			values_list.forEach((s) => {
				var tmp = s.trim().split(" ");
				if (tmp[0][0] != "F") return;
				var addr = parseInt(tmp[0].substr(1));
				var val = parseFloat(tmp[1]);
				if (isNaN(addr) || isNaN(val)) return;
				if (addr < 0 || addr >= conf.n_FP_registers) return;
				
				FP_regs["F" + addr].set(val);
			});
		})();
		
		// (6) INT regs [load by ui]
		INT_regs = {};
		for (var i in ui_ele.INT_regs) {
			INT_regs[i] = HDL.signal(ui.update_func(ui_ele.INT_regs[i])).set(0);
		}
		// load INT reg vals from config
		(() => {
			var values_list = conf.INT_reg_vals.trim().split("\n");
			values_list.forEach((s) => {
				var tmp = s.trim().split(" ");
				if (tmp[0][0] != "R") return;
				var addr = parseInt(tmp[0].substr(1));
				var val = parseInt(tmp[1]);
				if (isNaN(addr) || isNaN(val)) return;
				if (addr < 0 || addr >= conf.n_INT_registers) return;
				
				INT_regs["R" + addr].set(val);
			});
		})();
		
		// (7) memory
		ui.clear_memory_table();
		memory.initialize();
		
		// (8) instructions
		ui.clear_instruction_queue_table();
		instructions.initialize();
		
		// (9) memory controller
		memory_controller = {
			is_running : HDL.signal(
				ui.update_func(ui_ele.MC.is_running)).set(false),
			type : HDL.signal(ui.update_func(ui_ele.MC.type)).set(""),
			PC : HDL.signal(() => 0).set(""),
			addr : HDL.signal(() => 0).set(""),
			name : HDL.signal(ui.update_func(ui_ele.MC.name)).set(""),
			value : HDL.signal(() => 0).set(""),
			t_remaining : HDL.signal(ui.update_func(ui_ele.MC.time)).set("")
		};
		
		// (10) FP adder
		(() => {
			var n = conf.t_add_sub.length;
			
			FP_adder = [];
			for (var i = 0; i < n; i++) {
				var FPA = ui_ele.FPA[i];
				FP_adder.push({
					is_running : HDL.signal(
						ui.update_func(FPA.busy)).set(false),
					type : HDL.signal(ui.update_func(FPA.op)).set(""),
					PC : HDL.signal(() => 0).set(""),
					src1 : HDL.signal(() => 0).set(""),
					src2 : HDL.signal(() => 0).set(""),
					name : HDL.signal(ui.update_func(FPA.name)).set(""),
					value : HDL.signal(ui.update_func(FPA.value)).set(""),
					t_remaining : HDL.signal(ui.update_func(FPA.time)).set("")
				});
			}
		})();
		
		// (11) FP multiplier
		(() => {
			var n = conf.t_mul.length;
			
			FP_multiplier = [];
			for (var i = 0; i < n; i++) {
				var FPM = ui_ele.FPM[i];
				FP_multiplier.push({
					is_running : HDL.signal(
						ui.update_func(FPM.busy)).set(false),
					type : HDL.signal(ui.update_func(FPM.op)).set(""),
					PC : HDL.signal(() => 0).set(""),
					src1 : HDL.signal(() => 0).set(""),
					src2 : HDL.signal(() => 0).set(""),
					name : HDL.signal(ui.update_func(FPM.name)).set(""),
					value : HDL.signal(ui.update_func(FPM.value)).set(""),
					t_remaining : HDL.signal(ui.update_func(FPM.time)).set("")
				});
			}
		})();
		
		// (12) FP divider
		FP_divider = {
			is_running : HDL.signal(
				ui.update_func(ui_ele.FPD.is_running)).set(false),
			type : HDL.signal(ui.update_func(ui_ele.FPD.type)).set(""),
			PC : HDL.signal(() => 0).set(""),
			src1 : HDL.signal(() => 0).set(""),
			src2 : HDL.signal(() => 0).set(""),
			name : HDL.signal(ui.update_func(ui_ele.FPD.name)).set(""),
			value : HDL.signal(() => 0).set(""),
			t_remaining : HDL.signal(ui.update_func(ui_ele.FPD.time)).set("")
		};
		
		
		HDL.rising_edge();
		
		// setTimeout(get_CPU_clock_func(), CPU_exec_delay_time + 1000);
	};
	
	var CPU_power_off = function() {
		if (!has_power) {
			throw "ERROR: already powered off";
		}
		++CPU_exec_id;
		
		has_power = false;
	};
	
	
	var CPU_run = () => {
		if (!has_power) {
			throw "ERROR: run while powered off";
		}
		
		setTimeout(get_CPU_clock_func(), 100);
	};
	
	var CPU_pause = () => {
		++CPU_exec_id;
	}
	
	var CPU_step = () => {
		if (!has_power) {
			throw "ERROR: step while powered off";
		}
		
		get_CPU_clock_func()();
		++CPU_exec_id;
	};
	
	
	
	return {
		do_load : CPU_do_load,
		load_config : CPU_load_config,
		power_on : CPU_power_on,
		power_off : CPU_power_off,
		run : CPU_run,
		pause : CPU_pause,
		step : CPU_step,
		
		get_config : function() {
			return conf;
		}
	};
})();
